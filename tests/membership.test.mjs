import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { MEMBERSHIP_TIERS, getTier, getTierNewsletterSlugs, getJoinUrl } from "../lib/membership-tiers.js";
import {
	addMonths,
	extractEventType,
	extractPlanId,
	guessNetwork,
	isPublicRef,
	createPublicRef,
	membershipUpdateForEvent,
	nextPaidThrough,
	normalizeTzPhone,
	verifyUltranerSignature,
} from "../lib/membership-utils.js";

test("Tanzanian numbers normalize to 255 and nine digits", () => {
	for (const input of ["0712345678", "712345678", "+255 712 345 678", "255712345678", "0712-345-678"]) {
		assert.equal(normalizeTzPhone(input), "255712345678");
	}
	assert.equal(normalizeTzPhone("0612345678"), "255612345678");
	for (const input of ["", "12345", "0812345678", "2557123456789", null]) assert.equal(normalizeTzPhone(input), null);
});

test("the network is guessed from the prefix", () => {
	assert.equal(guessNetwork("0754000000"), "Vodacom");
	assert.equal(guessNetwork("0688000000"), "Airtel");
	assert.equal(guessNetwork("0714000000"), "Tigo");
	assert.equal(guessNetwork("0622000000"), "Halopesa");
	assert.equal(guessNetwork("0730000000"), null);
});

test("higher tiers unlock every lower tier's list", () => {
	assert.deepEqual(getTierNewsletterSlugs("member"), [MEMBERSHIP_TIERS[0].newsletterSlug]);
	assert.equal(getTierNewsletterSlugs("inner-circle").length, MEMBERSHIP_TIERS.length);
	assert.deepEqual(getTierNewsletterSlugs("nope"), []);
	assert.equal(getTier("pro").name, "Pro");
	assert.equal(new Set(MEMBERSHIP_TIERS.map((tier) => tier.newsletterSlug)).size, MEMBERSHIP_TIERS.length);
	for (const tier of MEMBERSHIP_TIERS) assert.ok(Number.isInteger(tier.price) && tier.price > 0);
});

test("the join URL follows APP_URL", () => {
	assert.equal(getJoinUrl({ APP_URL: "https://newsletter.example.com/" }), "https://newsletter.example.com/join");
});

test("plan ids are found by shape first, then by name", () => {
	assert.equal(extractPlanId({ event: "recurring.success", data: { transaction_id: "x", plan: { id: "UTRA-Rpl-abc" } } }), "UTRA-Rpl-abc");
	assert.equal(extractPlanId({ event: "recurring.cancelled", data: { plan_id: "p_1" } }), "p_1");
	assert.equal(extractPlanId({ event: "recurring.cancelled", data: {} }), null);
	assert.equal(extractEventType({ event: "Recurring.Success " }), "recurring.success");
	assert.equal(extractEventType({}), null);
});

test("webhook signatures match the raw body or its JSON.stringify form", () => {
	const secret = "whsec_test";
	const body = { event: "recurring.success", data: { plan_id: "UTRA-Rpl-1" } };
	const compact = JSON.stringify(body);
	const sign = (text) => `sha256=${createHmac("sha256", secret).update(text).digest("hex")}`;
	assert.equal(verifyUltranerSignature({ rawBody: compact, signature: sign(compact), secret }), true);
	const spaced = JSON.stringify(body, null, 2);
	assert.equal(verifyUltranerSignature({ rawBody: spaced, signature: sign(compact), secret }), true);
	assert.equal(verifyUltranerSignature({ rawBody: compact, signature: sign("other"), secret }), false);
	assert.equal(verifyUltranerSignature({ rawBody: compact, signature: sign(compact), secret: "" }), false);
	assert.equal(verifyUltranerSignature({ rawBody: compact, signature: null, secret }), false);
});

test("a payment covers a month, and a duplicate event doesn't add another", () => {
	const now = new Date("2026-01-31T10:00:00Z");
	assert.equal(addMonths(now).toISOString(), "2026-02-28T10:00:00.000Z");
	const first = nextPaidThrough(null, now);
	assert.equal(nextPaidThrough(first, now).getTime(), first.getTime());
	const later = new Date("2026-02-27T10:00:00Z");
	assert.equal(nextPaidThrough(first, later).toISOString(), "2026-03-27T10:00:00.000Z");
});

test("events map to membership changes", () => {
	assert.deepEqual(membershipUpdateForEvent("recurring.activated"), { status: "active", renew: true });
	assert.deepEqual(membershipUpdateForEvent("recurring.cancelled"), { status: "cancelled" });
	assert.equal(membershipUpdateForEvent("refund.success"), null);
});

test("public refs are long and URL safe", () => {
	const ref = createPublicRef();
	assert.ok(isPublicRef(ref));
	assert.equal(isPublicRef("short"), false);
	assert.equal(isPublicRef("../etc/passwd/abcdefgh"), false);
});

test("only the free newsletter's emails invite readers to join", async () => {
	const { renderEmail } = await import("../lib/render-email.js");
	const free = renderEmail({ markdown: "Hi", newsletter: { name: "Mafole Baraka", slug: "mafolebaraka" } });
	assert.match(free.html, /Become a paid member/);
	assert.match(free.text, /Become a paid member: .*\/join/);
	const paid = renderEmail({ markdown: "Hi", newsletter: { name: "Pro", slug: "mafolebaraka-pro" } });
	assert.doesNotMatch(paid.html, /Become a paid member/);
	const web = renderEmail({ markdown: "Hi", newsletter: { name: "Mafole Baraka", slug: "mafolebaraka" }, isWebVersion: true });
	assert.doesNotMatch(web.html, /Become a paid member/);
});
