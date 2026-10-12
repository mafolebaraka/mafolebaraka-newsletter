import mongoose from "mongoose";

// Every webhook Ultraner sends, as received: its payload shape isn't documented field by field, so the
// raw events are kept for checking what arrived. Deleted after 90 days.
const ultranerEventSchema = new mongoose.Schema(
	{
		bodyHash: { type: String, required: true, unique: true },
		event: { type: String },
		planId: { type: String },
		payload: { type: mongoose.Schema.Types.Mixed },
		handled: { type: Boolean, default: false },
		note: { type: String },
		createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 90 },
	},
	{ minimize: false }
);

export default mongoose.models.UltranerEvent || mongoose.model("UltranerEvent", ultranerEventSchema);
