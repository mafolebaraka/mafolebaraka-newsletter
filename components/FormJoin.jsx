"use client";

import { useState } from "react";
import { Check, CreditCard, Loader2, Smartphone, Wallet } from "lucide-react";
import MembershipStatus from "@/components/MembershipStatus";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const METHODS = [
	{ value: "mobile_money", label: "Mobile money", icon: Smartphone },
	{ value: "card", label: "Card", icon: CreditCard },
	{ value: "paypal", label: "PayPal", icon: Wallet },
];

function guessNetwork(phone, networks) {
	let digits = phone.replace(/[^\d]/g, "");
	if (digits.startsWith("255")) digits = digits.slice(3);
	else if (digits.startsWith("0")) digits = digits.slice(1);
	const prefix = digits.slice(0, 2);
	return networks.find((network) => network.prefixes.includes(prefix))?.value ?? "";
}

export default function FormJoin({ tiers, networks, initialTier, cancelled }) {
	const [tierId, setTierId] = useState(initialTier ?? tiers.find((tier) => tier.featured)?.id ?? tiers[0].id);
	const [method, setMethod] = useState("mobile_money");
	const [email, setEmail] = useState("");
	const [phone, setPhone] = useState("");
	const [network, setNetwork] = useState("");
	const [networkPicked, setNetworkPicked] = useState(false);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState(cancelled ? "Checkout was cancelled. Nothing was charged." : null);
	const [waiting, setWaiting] = useState(null);

	const tier = tiers.find((item) => item.id === tierId);

	async function submit(event) {
		event.preventDefault();
		setError(null);
		setPending(true);
		try {
			const form = new FormData(event.currentTarget);
			const response = await fetch("/api/membership/start", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ email, tier: tierId, method, phone, network, website: form.get("website") }),
			});
			const data = await response.json().catch(() => ({}));
			if (!response.ok) throw new Error(data.error || "Something went wrong. Try again.");
			if (data.redirectUrl) {
				window.location.assign(data.redirectUrl);
				return;
			}
			setWaiting({ publicRef: data.publicRef, channel: data.channel });
		} catch (caught) {
			setError(caught.message);
		}
		setPending(false);
	}

	if (waiting) {
		return (
			<div className="mx-auto w-full max-w-md">
				<MembershipStatus publicRef={waiting.publicRef} channel={waiting.channel} onRetry={() => setWaiting(null)} />
			</div>
		);
	}

	return (
		<form onSubmit={submit} className="w-full">
			<fieldset>
				<legend className="sr-only">Membership</legend>
				<div className="grid gap-3 sm:grid-cols-3">
					{tiers.map((item) => {
						const selected = item.id === tierId;
						return (
							<label
								key={item.id}
								className={cn(
									"relative flex cursor-pointer flex-col rounded-xl bg-card p-5 text-left shadow-border transition-shadow duration-150 hover:shadow-border-hover",
									selected && "ring-2 ring-primary"
								)}
							>
								<input
									type="radio"
									name="tier"
									value={item.id}
									checked={selected}
									onChange={() => setTierId(item.id)}
									className="sr-only"
								/>
								{item.featured && (
									<span className="absolute -top-2.5 right-4 rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
										Most popular
									</span>
								)}
								<span className="font-semibold">{item.name}</span>
								<span className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">{item.priceLabel}</span>
								<span className="text-xs text-muted-foreground">a month, about ${item.usd}</span>
								<ul className="mt-4 space-y-2 text-sm text-muted-foreground">
									{item.perks.map((perk) => (
										<li key={perk} className="flex gap-2">
											<Check className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
											<span>{perk}</span>
										</li>
									))}
								</ul>
							</label>
						);
					})}
				</div>
			</fieldset>

			<div className="mx-auto mt-8 w-full max-w-md space-y-5 rounded-xl bg-card p-5 shadow-border sm:p-6">
				<div aria-hidden="true" className="absolute -left-[10000px] size-px overflow-hidden">
					<input type="text" name="website" tabIndex={-1} autoComplete="off" />
				</div>

				<Field label="Email" htmlFor="join-email" hint="Paid issues are sent here.">
					<input
						id="join-email"
						type="email"
						required
						autoComplete="email"
						value={email}
						onChange={(event) => setEmail(event.target.value)}
						placeholder="you@example.com"
						className={inputClass}
					/>
				</Field>

				<fieldset>
					<legend className="mb-2 text-sm font-medium">Pay with</legend>
					<div className="grid grid-cols-3 gap-2">
						{METHODS.map(({ value, label, icon: Icon }) => (
							<label
								key={value}
								className={cn(
									"flex cursor-pointer flex-col items-center gap-1.5 rounded-lg bg-background px-2 py-3 text-xs font-medium shadow-border transition-shadow hover:shadow-border-hover",
									method === value && "ring-2 ring-primary"
								)}
							>
								<input
									type="radio"
									name="method"
									value={value}
									checked={method === value}
									onChange={() => setMethod(value)}
									className="sr-only"
								/>
								<Icon className="size-4" aria-hidden="true" />
								{label}
							</label>
						))}
					</div>
				</fieldset>

				{method === "mobile_money" && (
					<>
						<Field label="Mobile number" htmlFor="join-phone" hint="Tanzanian number. You'll approve a prompt on this phone each month.">
							<input
								id="join-phone"
								type="tel"
								required
								inputMode="tel"
								autoComplete="tel"
								value={phone}
								onChange={(event) => {
									setPhone(event.target.value);
									if (!networkPicked) setNetwork(guessNetwork(event.target.value, networks));
								}}
								placeholder="0712 345 678"
								className={inputClass}
							/>
						</Field>
						<Field label="Network" htmlFor="join-network">
							<select
								id="join-network"
								required
								value={network}
								onChange={(event) => {
									setNetwork(event.target.value);
									setNetworkPicked(true);
								}}
								className={inputClass}
							>
								<option value="" disabled>
									Choose your network
								</option>
								{networks.map((item) => (
									<option key={item.value} value={item.value}>
										{item.label}
									</option>
								))}
							</select>
						</Field>
					</>
				)}

				{method !== "mobile_money" && (
					<p className="text-sm text-muted-foreground">
						{method === "card"
							? "You'll go to a secure card checkout. Your membership renews automatically each month."
							: "You'll go to PayPal to approve it. PayPal bills the US dollar equivalent and renews each month."}
					</p>
				)}

				{error && (
					<p role="alert" className="text-sm text-destructive">
						{error}
					</p>
				)}

				<Button type="submit" size="lg" disabled={pending} className="w-full">
					{pending ? <Loader2 className="animate-spin" /> : `Join ${tier?.name} for ${tier?.priceLabel} a month`}
				</Button>
				<p className="text-center text-xs text-muted-foreground">
					Cancel anytime from the link in your welcome email. Payments are processed by Ultraner.
				</p>
			</div>
		</form>
	);
}

const inputClass =
	"h-10 w-full rounded-lg bg-background px-3 text-base shadow-border outline-none transition-shadow focus:shadow-border-hover focus:ring-3 focus:ring-ring/25";

function Field({ label, htmlFor, hint, children }) {
	return (
		<div>
			<label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium">
				{label}
			</label>
			{children}
			{hint && <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p>}
		</div>
	);
}
