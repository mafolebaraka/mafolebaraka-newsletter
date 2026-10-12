import { NextResponse } from "next/server";
import { getTier } from "@/lib/membership-tiers";
import { PAYMENT_METHODS, guessNetwork, isNetwork, normalizeTzPhone } from "@/lib/membership-utils";
import { startMembership } from "@/lib/memberships";
import { getClientIp, isRateLimited } from "@/lib/rate-limit";
import { isUltranerConfigured } from "@/lib/ultraner";
import { isPlainObject, normalizeEmail } from "@/lib/validation";

const PER_IP = { name: "membership-start-ip", limit: 6, window: "10 m" };

function fail(error, status = 400) {
	return NextResponse.json({ error }, { status });
}

export async function POST(request) {
	const body = await request.json().catch(() => null);
	if (!isPlainObject(body)) return fail("Invalid request");
	// People never see this field; bots fill in every input they find.
	if (body.website) return fail("Invalid request");

	const email = normalizeEmail(body.email);
	if (!email) return fail("Enter a valid email");
	const tier = getTier(body.tier);
	if (!tier) return fail("Pick a membership");
	const method = PAYMENT_METHODS.includes(body.method) ? body.method : null;
	if (!method) return fail("Pick a payment method");

	let phone;
	let network;
	if (method === "mobile_money") {
		phone = normalizeTzPhone(body.phone);
		if (!phone) return fail("Enter a Tanzanian mobile number, like 0712 345 678");
		network = isNetwork(body.network) ? body.network : guessNetwork(phone);
		if (!network) return fail("Pick your mobile money network");
	}

	if (!isUltranerConfigured()) return fail("Paid memberships open soon. Please check back later.", 503);
	if (await isRateLimited({ ...PER_IP, key: getClientIp(request.headers) })) {
		return fail("Too many attempts from your network. Try again in a few minutes.", 429);
	}

	try {
		const result = await startMembership({ email, tierId: tier.id, method, phone, network });
		return NextResponse.json(result);
	} catch (error) {
		return fail(error.message, 502);
	}
}
