import "server-only";
import { createHash } from "node:crypto";
import { sendAlert } from "@/lib/alerts";
import { getAppUrl, isSendingEnabled } from "@/lib/config";
import { upsertContact } from "@/lib/contacts";
import { connectDb } from "@/lib/db";
import {
	FREE_NEWSLETTER_SLUG,
	GRACE_DAYS,
	MEMBERSHIP_CURRENCY,
	MEMBERSHIP_TIERS,
	formatPrice,
	getTier,
	getTierNewsletterSlugs,
} from "@/lib/membership-tiers";
import {
	accessEndsAt,
	createPublicRef,
	extractEventType,
	extractPlanId,
	isActivePlanStatus,
	membershipUpdateForEvent,
	nextPaidThrough,
} from "@/lib/membership-utils";
import { escapeHtml } from "@/lib/render-email";
import { sendSesEmail } from "@/lib/ses";
import { formatFromAddress } from "@/lib/sending-rules";
import { createRecurringPlan, getRecurringPlan, isSandboxKey } from "@/lib/ultraner";
import Contact from "@/models/Contact";
import Membership from "@/models/Membership";
import Newsletter from "@/models/Newsletter";
import UltranerEvent from "@/models/UltranerEvent";

const SOURCE = "membership";
const CHECK_INTERVAL_MS = 10_000;

export async function getFreeNewsletter() {
	await connectDb();
	return Newsletter.findOne({ slug: FREE_NEWSLETTER_SLUG }).lean();
}

// The paid lists, one per tier, made on first use with the free newsletter's sender details. They have
// no public archive and no list cleanup: a paying reader is never dropped for not opening.
export async function ensurePaidNewsletters() {
	const free = await getFreeNewsletter();
	if (!free) throw new Error(`The free newsletter "${FREE_NEWSLETTER_SLUG}" doesn't exist`);
	const existing = await Newsletter.find({ slug: { $in: MEMBERSHIP_TIERS.map((tier) => tier.newsletterSlug) } }).lean();
	const bySlug = new Map(existing.map((newsletter) => [newsletter.slug, newsletter]));
	for (const tier of MEMBERSHIP_TIERS) {
		if (bySlug.has(tier.newsletterSlug)) continue;
		try {
			const created = await Newsletter.create({
				name: tier.newsletterName,
				slug: tier.newsletterSlug,
				imageUrl: free.imageUrl,
				fromName: free.fromName,
				fromEmail: free.fromEmail,
				replyTo: free.replyTo,
				postalAddress: free.postalAddress,
				description: `Paid ${tier.name} members of ${free.name}.`,
				socialLinks: free.socialLinks,
				archiveEnabled: false,
				requireConfirmation: false,
				cleanup: { enabled: false },
			});
			bySlug.set(tier.newsletterSlug, created.toObject());
		} catch (error) {
			if (error?.code !== 11000) throw error;
			bySlug.set(tier.newsletterSlug, await Newsletter.findOne({ slug: tier.newsletterSlug }).lean());
		}
	}
	return { free, bySlug };
}

export async function startMembership({ email, tierId, method, phone, network }) {
	const tier = getTier(tierId);
	if (!tier) throw new Error("Pick a membership");
	await connectDb();
	const appUrl = getAppUrl();
	const publicRef = createPublicRef();
	const membership = await Membership.create({
		email,
		tier: tier.id,
		channel: method,
		phone: method === "mobile_money" ? phone : undefined,
		network: method === "mobile_money" ? network : undefined,
		amount: tier.price,
		currency: MEMBERSHIP_CURRENCY,
		publicRef,
		sandbox: isSandboxKey(),
	});

	const base = {
		name: `${tier.newsletterName} (monthly)`,
		amount: tier.price,
		currency: MEMBERSHIP_CURRENCY,
		interval_type: "monthly",
	};
	const body =
		method === "mobile_money"
			? { ...base, mno_provider: network, account_number: phone }
			: {
					...base,
					channel: method,
					payer_email: email,
					return_url: `${appUrl}/join/thanks?ref=${publicRef}`,
					cancel_url: `${appUrl}/join?tier=${tier.id}&cancelled=1`,
				};

	let plan;
	try {
		plan = await createRecurringPlan(body);
	} catch (error) {
		await Membership.updateOne({ _id: membership._id }, { $set: { status: "failed", lastEvent: `create: ${error.message}`.slice(0, 500) } });
		console.error("[membership] Could not create the Ultraner plan:", error.message);
		throw new Error("The payment could not be started. Check the details and try again.");
	}
	if (!plan.id) console.warn("[membership] Ultraner returned no plan id:", JSON.stringify(plan.raw).slice(0, 500));
	await Membership.updateOne(
		{ _id: membership._id },
		{ $set: { planId: plan.id ?? undefined, manageUrl: plan.manageUrl ?? undefined } }
	);
	return { publicRef, redirectUrl: plan.redirectUrl, channel: method };
}

// Puts the reader on their tier's paid lists, and on the free list too.
async function grantAccess(membership, { firstTime }) {
	const { free, bySlug } = await ensurePaidNewsletters();
	const { email } = membership;
	await upsertContact({ newsletter: free, email, source: SOURCE, resubscribe: false });
	for (const slug of getTierNewsletterSlugs(membership.tier)) {
		const newsletter = bySlug.get(slug);
		if (!newsletter) continue;
		// Paying is a fresh opt in; a renewal only brings back access that lapsed, never an unsubscribe.
		const { contact } = await upsertContact({ newsletter, email, source: SOURCE, resubscribe: firstTime });
		if (!firstTime && contact.status === "dormant") {
			await Contact.updateOne({ _id: contact._id, status: "dormant" }, { $set: { status: "active" } });
		}
	}
	await Membership.updateOne({ _id: membership._id }, { $set: { accessGranted: true } });
}

// Paid lists an email still has a right to, from every membership whose paid period hasn't run out.
async function coveredSlugs(email, now, exceptId) {
	const others = await Membership.find({
		email,
		_id: { $ne: exceptId },
		accessGranted: true,
		paidThrough: { $gte: new Date(now.getTime() - GRACE_DAYS * 86_400_000) },
	})
		.select({ tier: 1 })
		.lean();
	return new Set(others.flatMap((other) => getTierNewsletterSlugs(other.tier)));
}

async function revokeAccess(membership, now) {
	const covered = await coveredSlugs(membership.email, now, membership._id);
	const slugs = getTierNewsletterSlugs(membership.tier).filter((slug) => !covered.has(slug));
	if (slugs.length > 0) {
		const newsletters = await Newsletter.find({ slug: { $in: slugs } }).select({ _id: 1 }).lean();
		await Contact.updateMany(
			{ email: membership.email, newsletterId: { $in: newsletters.map((n) => n._id) }, status: "active" },
			{ $set: { status: "dormant" } }
		);
	}
	await Membership.updateOne({ _id: membership._id }, { $set: { accessGranted: false, status: "expired" } });
}

// Run before every send: readers whose paid month (plus grace) ran out leave the paid lists.
// Never throws, so a problem here can't stop a campaign.
export async function expireMemberships(now = new Date()) {
	try {
		await connectDb();
		const cutoff = new Date(now.getTime() - GRACE_DAYS * 86_400_000);
		const lapsed = await Membership.find({ accessGranted: true, paidThrough: { $lt: cutoff } }).lean();
		for (const membership of lapsed) await revokeAccess(membership, now);
		return lapsed.length;
	} catch (error) {
		console.error("[membership] Expiry check failed:", error.message);
		return 0;
	}
}

async function applyUpdate(membership, update, { now = new Date(), eventName }) {
	const set = { status: update.status, lastEventAt: now, lastEvent: eventName };
	if (update.renew) set.paidThrough = nextPaidThrough(membership.paidThrough, now);
	// A late failure or past due notice never reopens an expired membership.
	const filter = { _id: membership._id, ...(update.renew ? {} : { status: { $ne: "expired" } }) };
	await Membership.updateOne(filter, { $set: set });
	if (!update.renew) return;

	// "activated" and the first "success" arrive together: only one of them claims the first payment.
	const claimed = await Membership.updateOne({ _id: membership._id, activatedAt: null }, { $set: { activatedAt: now } });
	const firstTime = claimed.modifiedCount === 1;
	await grantAccess(membership, { firstTime });
	if (firstTime) {
		await sendWelcome({ ...membership, ...set });
		const tier = getTier(membership.tier);
		await sendAlert({
			key: `member:${membership._id}`,
			title: `New paid member: ${tier?.name ?? membership.tier}`,
			detail: `${membership.email} joined ${tier?.name ?? membership.tier} for ${formatPrice(membership.amount)} a month by ${membership.channel.replace("_", " ")}${membership.sandbox ? " (sandbox test)" : ""}.`,
			path: "/contacts",
			cooldownMinutes: 1,
		});
	}
}

export async function handleUltranerEvent(payload, rawBody) {
	await connectDb();
	const eventName = extractEventType(payload);
	const planId = extractPlanId(payload);
	const bodyHash = createHash("sha256").update(rawBody).digest("hex");
	try {
		await UltranerEvent.create({ bodyHash, event: eventName, planId, payload });
	} catch (error) {
		if (error?.code === 11000) return { handled: false, note: "duplicate" };
		throw error;
	}

	const update = membershipUpdateForEvent(eventName);
	const membership = planId ? await Membership.findOne({ planId }).lean() : null;
	const note = !update ? "event not used" : !membership ? "no membership for this plan" : "applied";
	if (update && membership) await applyUpdate(membership, update, { eventName });
	await UltranerEvent.updateOne({ bodyHash }, { $set: { handled: note === "applied", note } });
	await expireMemberships();
	return { handled: note === "applied", note };
}

// What the join page shows while it waits. A pending plan is also checked with Ultraner directly, in
// case its webhook is late or not set up yet.
export async function getMembershipStatus(publicRef) {
	await connectDb();
	let membership = await Membership.findOne({ publicRef }).lean();
	if (!membership) return null;

	const now = new Date();
	const stale = !membership.lastCheckedAt || now - membership.lastCheckedAt > CHECK_INTERVAL_MS;
	if (membership.status === "pending" && membership.planId && stale) {
		await Membership.updateOne({ _id: membership._id }, { $set: { lastCheckedAt: now } });
		try {
			const plan = await getRecurringPlan(membership.planId);
			if (isActivePlanStatus(plan.status)) {
				await applyUpdate(membership, { status: "active", renew: true }, { now, eventName: `plan check: ${plan.status}` });
				membership = await Membership.findById(membership._id).lean();
			} else if (["failed", "cancelled"].includes(String(plan.status).toLowerCase())) {
				await Membership.updateOne({ _id: membership._id, status: "pending" }, { $set: { status: "failed" } });
				membership = { ...membership, status: "failed" };
			}
		} catch (error) {
			console.error("[membership] Plan check failed:", error.message);
		}
	}

	const tier = getTier(membership.tier);
	return {
		status: membership.status,
		tier: tier?.name ?? membership.tier,
		channel: membership.channel,
		manageUrl: membership.status === "pending" ? null : (membership.manageUrl ?? null),
		paidThrough: membership.paidThrough ?? null,
		accessEndsAt: accessEndsAt(membership.paidThrough, GRACE_DAYS),
	};
}

async function sendWelcome(membership) {
	if (!isSendingEnabled() || membership.welcomeSentAt) return;
	const free = await getFreeNewsletter();
	if (!free) return;
	const tier = getTier(membership.tier);
	const tierName = tier?.name ?? "paid";
	const subject = `Welcome to ${free.name} ${tierName}`;
	const manage = membership.manageUrl;
	const renewal =
		membership.channel === "mobile_money"
			? "Each month you'll get a prompt on your phone to approve the renewal. Approve it to keep your access."
			: "Your membership renews automatically each month.";
	const perks = (tier?.perks ?? []).map((perk) => `<li>${escapeHtml(perk)}</li>`).join("");
	const html = `<!doctype html><html><body style="margin:0;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#18181b;">
<div style="max-width:560px;margin:0 auto;">
<p>Thank you for becoming a ${escapeHtml(tierName)} member of ${escapeHtml(free.name)}.</p>
${perks ? `<p>Here's what you get:</p><ul>${perks}</ul>` : ""}
<p>${escapeHtml(renewal)}</p>
${manage ? `<p>You can see or cancel your membership anytime here: <a href="${escapeHtml(manage)}">manage your membership</a>. Keep this email so you can find the link later.</p>` : ""}
<p>${escapeHtml(free.fromName || "")}</p>
<p style="font-size:12px;color:#71717a;">${escapeHtml(free.postalAddress || "")}</p>
</div></body></html>`;
	const text = [
		`Thank you for becoming a ${tierName} member of ${free.name}.`,
		...(tier?.perks ?? []).map((perk) => `• ${perk}`),
		renewal,
		manage ? `See or cancel your membership anytime: ${manage}` : null,
		free.fromName,
		free.postalAddress,
	]
		.filter(Boolean)
		.join("\n\n");
	try {
		await sendSesEmail({
			from: formatFromAddress(free),
			to: membership.email,
			replyTo: free.replyTo || undefined,
			subject,
			html,
			text,
			tags: [{ name: "kind", value: "membership" }],
		});
		await Membership.updateOne({ _id: membership._id }, { $set: { welcomeSentAt: new Date() } });
	} catch (error) {
		console.error("[membership] Welcome email failed:", error.message);
	}
}

export async function listMemberships() {
	await connectDb();
	return Membership.find({ status: { $ne: "pending" } }).sort({ createdAt: -1 }).limit(500).lean();
}
