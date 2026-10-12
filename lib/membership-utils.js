import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Ultraner's Tanzanian mobile money networks. The value is what its API calls the provider.
export const MOBILE_NETWORKS = [
	{ value: "Vodacom", label: "Vodacom M-Pesa", prefixes: ["74", "75", "76"] },
	{ value: "Airtel", label: "Airtel Money", prefixes: ["68", "69", "78"] },
	{ value: "Tigo", label: "Mixx by Yas (Tigo Pesa)", prefixes: ["65", "67", "71", "77"] },
	{ value: "Halopesa", label: "Halopesa", prefixes: ["61", "62"] },
];

export const PAYMENT_METHODS = ["mobile_money", "card", "paypal"];

// 0712 345 678, 712345678, +255 712 345 678 and 255712345678 all become 255712345678.
export function normalizeTzPhone(input) {
	let digits = String(input ?? "").replace(/[^\d]/g, "");
	if (digits.startsWith("255")) digits = digits.slice(3);
	else if (digits.startsWith("0")) digits = digits.slice(1);
	return /^[67]\d{8}$/.test(digits) ? `255${digits}` : null;
}

export function guessNetwork(phone) {
	const normalized = normalizeTzPhone(phone);
	if (!normalized) return null;
	const prefix = normalized.slice(3, 5);
	return MOBILE_NETWORKS.find((network) => network.prefixes.includes(prefix))?.value ?? null;
}

export function isNetwork(value) {
	return MOBILE_NETWORKS.some((network) => network.value === value);
}

export function createPublicRef() {
	return randomBytes(16).toString("base64url");
}

export function isPublicRef(value) {
	return typeof value === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(value);
}

// Webhook payloads aren't documented field by field, so the plan id is looked for by name, then by shape.
const PLAN_ID_KEYS = ["plan_id", "recurring_plan_id", "subscription_id", "recurring_id", "id"];
const PLAN_ID_PATTERN = /^UTRA-Rpl-/i;

export function extractPlanId(payload) {
	const seen = new Set();
	const byShape = findValue(payload, (value) => typeof value === "string" && PLAN_ID_PATTERN.test(value), seen);
	if (byShape) return byShape;
	const data = payload?.data ?? payload;
	for (const key of PLAN_ID_KEYS) {
		const value = data?.[key] ?? data?.plan?.[key] ?? data?.recurring?.[key];
		if (typeof value === "string" && value.trim()) return value.trim();
	}
	return null;
}

function findValue(node, matches, seen, depth = 0) {
	if (depth > 6 || node === null || typeof node !== "object" || seen.has(node)) return null;
	seen.add(node);
	for (const value of Object.values(node)) {
		if (matches(value)) return value;
		const nested = findValue(value, matches, seen, depth + 1);
		if (nested) return nested;
	}
	return null;
}

export function extractEventType(payload) {
	const type = payload?.event ?? payload?.type ?? payload?.event_type;
	return typeof type === "string" ? type.trim().toLowerCase() : null;
}

// Signed as "sha256=" + HMAC-SHA256(secret, JSON body). The raw body is checked first, then the body as
// JSON.stringify writes it, which is how Ultraner's own example computes it.
export function verifyUltranerSignature({ rawBody, signature, secret }) {
	if (!secret || typeof signature !== "string" || !signature) return false;
	const candidates = [rawBody];
	try {
		candidates.push(JSON.stringify(JSON.parse(rawBody)));
	} catch {
		// Not JSON: only the raw body can match.
	}
	const given = signature.trim().replace(/^sha256=/i, "").toLowerCase();
	return candidates.some((body) => {
		const expected = createHmac("sha256", secret).update(body).digest("hex");
		return safeEqual(given, expected);
	});
}

function safeEqual(a, b) {
	const left = Buffer.from(a);
	const right = Buffer.from(b);
	return left.length === right.length && timingSafeEqual(left, right);
}

export function addMonths(date, months = 1) {
	const result = new Date(date);
	const day = result.getUTCDate();
	result.setUTCDate(1);
	result.setUTCMonth(result.getUTCMonth() + months);
	const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
	result.setUTCDate(Math.min(day, lastDay));
	return result;
}

// A payment covers a month from when it lands. A second event for the same charge (activated and
// success arrive together) lands on the same date, so it never adds a second month.
export function nextPaidThrough(current, now = new Date()) {
	const fromNow = addMonths(now, 1);
	return current && new Date(current) > fromNow ? new Date(current) : fromNow;
}

export function accessEndsAt(paidThrough, graceDays) {
	if (!paidThrough) return null;
	return new Date(new Date(paidThrough).getTime() + graceDays * 24 * 60 * 60 * 1000);
}

// What a webhook event means for the membership. Payment events renew; the rest only change the label,
// and access then runs until the paid period (plus grace) ends.
export function membershipUpdateForEvent(type) {
	switch (type) {
		case "recurring.activated":
		case "recurring.success":
		case "payment.success":
			return { status: "active", renew: true };
		case "recurring.past_due":
			return { status: "past_due" };
		case "recurring.failed":
			return { status: "failed" };
		case "recurring.cancelled":
			return { status: "cancelled" };
		default:
			return null;
	}
}

// GET /v1/recurring/plans/{id} reports a status; these mean the first charge went through.
export function isActivePlanStatus(status) {
	return ["active", "trialing", "past_due"].includes(String(status ?? "").toLowerCase());
}
