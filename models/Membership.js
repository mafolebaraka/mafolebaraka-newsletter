import mongoose from "mongoose";

export const MEMBERSHIP_STATUSES = ["pending", "active", "past_due", "cancelled", "failed", "expired"];

// One paid subscription, created from /join and kept current by Ultraner's webhooks (lib/memberships.js).
const membershipSchema = new mongoose.Schema(
	{
		email: { type: String, required: true, lowercase: true, trim: true },
		tier: { type: String, required: true },
		channel: { type: String, enum: ["mobile_money", "card", "paypal"], required: true },
		phone: { type: String },
		network: { type: String },
		amount: { type: Number },
		currency: { type: String },
		// Ultraner's recurring plan id (UTRA-Rpl-...) and its public page to view or cancel.
		planId: { type: String, index: { unique: true, sparse: true } },
		manageUrl: { type: String },
		sandbox: { type: Boolean, default: false },
		// The unguessable id the join page polls with; the plan id never reaches the browser.
		publicRef: { type: String, required: true, unique: true },
		status: { type: String, enum: MEMBERSHIP_STATUSES, default: "pending" },
		paidThrough: { type: Date },
		// True while the reader is on the paid lists; expiry turns it off (lib/memberships.js).
		accessGranted: { type: Boolean, default: false },
		activatedAt: { type: Date },
		lastEventAt: { type: Date },
		lastEvent: { type: String },
		welcomeSentAt: { type: Date },
		// The status page asks Ultraner directly at most this often, in case a webhook is late.
		lastCheckedAt: { type: Date },
	},
	{ timestamps: true }
);

membershipSchema.index({ email: 1, status: 1 });
membershipSchema.index({ accessGranted: 1, paidThrough: 1 });

export default mongoose.models.Membership || mongoose.model("Membership", membershipSchema);
