import Link from "next/link";
import AvatarNewsletter from "@/components/AvatarNewsletter";
import FormJoin from "@/components/FormJoin";
import { connectDb } from "@/lib/db";
import { FREE_NEWSLETTER_SLUG, MEMBERSHIP_TIERS, formatPrice, getTier } from "@/lib/membership-tiers";
import { MOBILE_NETWORKS } from "@/lib/membership-utils";
import { getArchiveUrls } from "@/lib/archive-hosts";
import Newsletter from "@/models/Newsletter";

export const metadata = {
	title: { absolute: "Become a paid member · Mafole Baraka" },
	description: "Support the newsletter and get members only issues. Pay by mobile money, card or PayPal.",
	robots: { index: true, follow: true },
};

export default async function JoinPage({ searchParams }) {
	const { tier, cancelled } = await searchParams;
	const newsletter = await getNewsletter();
	const name = newsletter?.name ?? "Mafole Baraka";
	const tiers = MEMBERSHIP_TIERS.map(({ id, name: tierName, price, usd, perks, featured }) => ({
		id,
		name: tierName,
		priceLabel: formatPrice(price),
		usd,
		perks,
		featured: Boolean(featured),
	}));
	const networks = MOBILE_NETWORKS.map(({ value, label, prefixes }) => ({ value, label, prefixes }));
	const archiveUrl = newsletter?.archiveEnabled ? getArchiveUrls(newsletter).siteIndex : null;

	return (
		<main className="min-h-dvh bg-background px-4 py-14 sm:py-20">
			<div className="mx-auto flex max-w-3xl flex-col items-center text-center">
				{newsletter && (
					<AvatarNewsletter newsletter={newsletter} size={56} className="rounded-xl shadow-[0_8px_24px_-8px_rgb(0_0_0/0.25)]" />
				)}
				<h1 className="mt-5 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
					Become a paid member of {name}
				</h1>
				<p className="mt-3 max-w-xl text-muted-foreground text-balance">
					The free newsletter stays free. Members get extra issues and keep this work independent. Pay with mobile
					money, card or PayPal, and cancel anytime.
				</p>
			</div>
			<div className="mx-auto mt-10 max-w-3xl">
				<FormJoin
					tiers={tiers}
					networks={networks}
					initialTier={getTier(typeof tier === "string" ? tier : null)?.id ?? null}
					cancelled={cancelled === "1"}
				/>
			</div>
			{archiveUrl && (
				<p className="mt-10 text-center text-sm text-muted-foreground">
					Not ready?{" "}
					<Link href={archiveUrl} className="font-medium text-foreground underline underline-offset-4">
						Read the free issues
					</Link>
				</p>
			)}
		</main>
	);
}

async function getNewsletter() {
	try {
		await connectDb();
		return await Newsletter.findOne({ slug: FREE_NEWSLETTER_SLUG })
			.select({ name: 1, slug: 1, imageUrl: 1, archiveEnabled: 1 })
			.lean();
	} catch (error) {
		console.error("[join] Could not load the newsletter:", error.message);
		return null;
	}
}
