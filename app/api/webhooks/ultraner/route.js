import { NextResponse } from "next/server";
import { verifyUltranerSignature } from "@/lib/membership-utils";
import { handleUltranerEvent } from "@/lib/memberships";
import { isPlainObject } from "@/lib/validation";

const MAX_BODY_LENGTH = 256 * 1024;

// Ultraner Console > Webhooks points here. Its signing secret goes in ULTRANER_WEBHOOK_SECRET.
export async function POST(request) {
	const rawBody = await request.text();
	if (rawBody.length > MAX_BODY_LENGTH) return NextResponse.json({ error: "Too large" }, { status: 413 });

	const secret = process.env.ULTRANER_WEBHOOK_SECRET?.trim();
	if (!secret) {
		console.error("[ultraner-webhook] ULTRANER_WEBHOOK_SECRET is not set");
		return NextResponse.json({ error: "Not configured" }, { status: 503 });
	}
	const signature = request.headers.get("x-ultraner-signature");
	if (!verifyUltranerSignature({ rawBody, signature, secret })) {
		return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
	}

	let payload;
	try {
		payload = JSON.parse(rawBody);
	} catch {
		return NextResponse.json({ ok: true, ignored: true });
	}
	if (!isPlainObject(payload)) return NextResponse.json({ ok: true, ignored: true });

	try {
		const result = await handleUltranerEvent(payload, rawBody);
		return NextResponse.json({ ok: true, ...result });
	} catch (error) {
		// A 500 makes Ultraner retry later.
		console.error("[ultraner-webhook] Could not handle the event:", error.message);
		return NextResponse.json({ error: "Could not handle the event" }, { status: 500 });
	}
}
