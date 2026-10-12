import { NextResponse } from "next/server";
import { isPublicRef } from "@/lib/membership-utils";
import { getMembershipStatus } from "@/lib/memberships";
import { getClientIp, isRateLimited } from "@/lib/rate-limit";

// The join page polls every few seconds for up to about ten minutes.
const PER_IP = { name: "membership-status-ip", limit: 240, window: "10 m" };

export async function GET(request) {
	const ref = request.nextUrl.searchParams.get("ref");
	if (!isPublicRef(ref)) return NextResponse.json({ error: "Not found" }, { status: 404 });
	if (await isRateLimited({ ...PER_IP, key: getClientIp(request.headers) })) {
		return NextResponse.json({ error: "Too many requests" }, { status: 429 });
	}
	const status = await getMembershipStatus(ref);
	if (!status) return NextResponse.json({ error: "Not found" }, { status: 404 });
	return NextResponse.json(status, { headers: { "Cache-Control": "no-store" } });
}
