"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, Loader2, Smartphone, X } from "lucide-react";
import { Button } from "@/components/ui/button";

const POLL_MS = 4000;
// Mobile money prompts close after 10 minutes.
const GIVE_UP_MS = 11 * 60 * 1000;

// Waits for the first payment of a membership: the phone prompt, or the return from card or PayPal checkout.
export default function MembershipStatus({ publicRef, channel, onRetry }) {
	const [state, setState] = useState({ status: "pending" });
	const [timedOut, setTimedOut] = useState(false);

	useEffect(() => {
		let stopped = false;
		let timer;
		const started = Date.now();
		async function poll() {
			try {
				const response = await fetch(`/api/membership/status?ref=${encodeURIComponent(publicRef)}`, { cache: "no-store" });
				if (response.ok) {
					const data = await response.json();
					if (stopped) return;
					setState(data);
					if (data.status !== "pending") return;
				}
			} catch {
				// Try again on the next tick.
			}
			if (stopped) return;
			if (Date.now() - started > GIVE_UP_MS) return setTimedOut(true);
			timer = setTimeout(poll, POLL_MS);
		}
		poll();
		return () => {
			stopped = true;
			clearTimeout(timer);
		};
	}, [publicRef]);

	const isMobile = (state.channel ?? channel) === "mobile_money";

	if (state.status === "active" || state.status === "past_due") {
		return (
			<Card icon={Check} tone="success" title={`Welcome, you're a ${state.tier} member`}>
				<p>Paid issues will land in your inbox. A welcome email with your membership details is on its way.</p>
				{state.manageUrl && (
					<p className="mt-3">
						<a href={state.manageUrl} className="font-medium text-foreground underline underline-offset-4">
							Manage or cancel your membership
						</a>
					</p>
				)}
			</Card>
		);
	}

	if (state.status === "failed" || state.status === "cancelled" || state.status === "expired" || timedOut) {
		return (
			<Card icon={X} title={timedOut ? "We didn't hear back yet" : "The payment didn't go through"}>
				<p>
					{timedOut
						? "If you approved the payment, your membership will start within a few minutes and you'll get a welcome email."
						: "Nothing was charged. Check your balance or details and try again."}
				</p>
				{onRetry ? (
					<Button className="mt-4" variant="outline" onClick={onRetry}>
						Try again
					</Button>
				) : (
					<p className="mt-3">
						<Link href="/join" className="font-medium text-foreground underline underline-offset-4">
							Try again
						</Link>
					</p>
				)}
			</Card>
		);
	}

	return (
		<Card icon={isMobile ? Smartphone : Loader2} spin={!isMobile} title={isMobile ? "Check your phone" : "Confirming your payment"}>
			{isMobile ? (
				<p>
					Approve the payment prompt on your phone and enter your PIN. This page updates on its own once it goes
					through.
				</p>
			) : (
				<p>This takes a few seconds. You can keep this page open.</p>
			)}
			<p className="mt-3 flex items-center justify-center gap-2 text-xs">
				<Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> Waiting for confirmation
			</p>
		</Card>
	);
}

function Card({ icon: Icon, tone, spin, title, children }) {
	return (
		<div role="status" className="w-full rounded-xl bg-card p-6 text-center shadow-border animate-enter sm:p-8">
			<div
				className={
					tone === "success"
						? "mx-auto flex size-10 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
						: "mx-auto flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground"
				}
			>
				<Icon className={spin ? "size-5 animate-spin" : "size-5 animate-icon-in"} aria-hidden="true" />
			</div>
			<h2 className="mt-4 text-lg font-semibold tracking-tight text-balance">{title}</h2>
			<div className="mt-1.5 text-sm leading-relaxed text-pretty text-muted-foreground">{children}</div>
		</div>
	);
}
