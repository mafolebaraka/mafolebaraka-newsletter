// Paid membership for the free newsletter, billed through Ultraner (lib/ultraner.js).
// Edit names, prices and perks here. Prices are monthly, in whole Tanzanian shillings.
// Each tier gets its own paid list in the dashboard; a higher tier is also added to every lower tier's
// list, so an issue sent to "Member" reaches every paying reader.

export const FREE_NEWSLETTER_SLUG = "mafolebaraka";
export const MEMBERSHIP_CURRENCY = "TZS";
// Days of access kept after a missed renewal, while Ultraner retries or the reader approves the next prompt.
export const GRACE_DAYS = 3;

export const MEMBERSHIP_TIERS = [
	{
		id: "member",
		name: "Member",
		price: 8000,
		usd: 3,
		newsletterSlug: "mafolebaraka-member",
		newsletterName: "Mafole Baraka Members",
		perks: ["Every free issue, plus a members only issue each month", "Full archive of past paid issues", "Support independent writing from Dar es Salaam"],
	},
	{
		id: "pro",
		name: "Pro",
		price: 24000,
		usd: 9,
		newsletterSlug: "mafolebaraka-pro",
		newsletterName: "Mafole Baraka Pro",
		perks: ["Everything in Member", "Weekly deep dives, templates and playbooks", "Early access to events and launches"],
		featured: true,
	},
	{
		id: "inner-circle",
		name: "Inner Circle",
		price: 77000,
		usd: 29,
		newsletterSlug: "mafolebaraka-inner-circle",
		newsletterName: "Mafole Baraka Inner Circle",
		perks: ["Everything in Pro", "Monthly small group call with Baraka", "Direct line for questions and feedback"],
	},
];

export function getTier(id) {
	return MEMBERSHIP_TIERS.find((tier) => tier.id === id) ?? null;
}

// The paid lists a tier unlocks: its own and every tier below it.
export function getTierNewsletterSlugs(id) {
	const index = MEMBERSHIP_TIERS.findIndex((tier) => tier.id === id);
	if (index < 0) return [];
	return MEMBERSHIP_TIERS.slice(0, index + 1).map((tier) => tier.newsletterSlug);
}

export function getJoinUrl(env = process.env) {
	const vercelUrl = env.VERCEL_PROJECT_PRODUCTION_URL;
	const base = (env.APP_URL || (vercelUrl ? `https://${vercelUrl}` : "http://localhost:3000")).replace(/\/$/, "");
	return `${base}/join`;
}

export function formatPrice(amount, currency = MEMBERSHIP_CURRENCY) {
	return `${currency} ${Number(amount).toLocaleString("en-US")}`;
}
