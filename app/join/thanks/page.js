import { Link2Off } from "lucide-react";
import CardNotice from "@/components/CardNotice";
import MembershipStatus from "@/components/MembershipStatus";
import { isPublicRef } from "@/lib/membership-utils";

// Card and PayPal checkouts come back here.
export const metadata = {
	title: { absolute: "Your membership · Mafole Baraka" },
	robots: { index: false, follow: false },
	referrer: "no-referrer",
};

export default async function JoinThanksPage({ searchParams }) {
	const { ref } = await searchParams;
	return (
		<main className="flex min-h-dvh items-center justify-center bg-background px-4 py-16">
			<div className="w-full max-w-sm">
				{isPublicRef(ref) ? (
					<MembershipStatus publicRef={ref} channel="card" />
				) : (
					<CardNotice icon={Link2Off} title="This link doesn't work">
						Start again from the membership page.
					</CardNotice>
				)}
			</div>
		</main>
	);
}
