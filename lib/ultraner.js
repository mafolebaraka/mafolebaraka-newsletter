import "server-only";

// Ultraner API (https://ultraner.com/docs.md). A uk_test_ key uses the sandbox ("-sandbox" after the
// version in the path), a uk_live_ key the real rails. Server to server calls send no Origin header,
// so a live key's authorized domain check doesn't apply.
const BASE_URL = "https://api.ultraner.com";

export function getUltranerKey() {
	return process.env.ULTRANER_API_KEY?.trim() || null;
}

export function isUltranerConfigured() {
	return Boolean(getUltranerKey());
}

export function isSandboxKey(key = getUltranerKey()) {
	return Boolean(key?.startsWith("uk_test_"));
}

function versionPath(version) {
	return isSandboxKey() ? `/${version}-sandbox` : `/${version}`;
}

async function request(method, path, body) {
	const key = getUltranerKey();
	if (!key) throw new Error("Payments are not set up yet (ULTRANER_API_KEY)");
	const response = await fetch(`${BASE_URL}${path}`, {
		method,
		headers: { "X-API-Key": key, "Content-Type": "application/json", Accept: "application/json" },
		body: body ? JSON.stringify(body) : undefined,
		signal: AbortSignal.timeout(20_000),
		cache: "no-store",
	});
	const text = await response.text();
	let json = null;
	try {
		json = text ? JSON.parse(text) : null;
	} catch {
		// Kept as text in the error below.
	}
	if (!response.ok || json?.success === false) {
		const message = json?.error?.message ?? json?.message ?? json?.error ?? text.slice(0, 300);
		const error = new Error(`Ultraner ${response.status}: ${typeof message === "string" ? message : JSON.stringify(message)}`);
		error.status = response.status;
		error.body = json ?? text;
		throw error;
	}
	return json;
}

// The plan fields may sit at the top level or under "data".
function unwrap(json) {
	return json?.data && typeof json.data === "object" ? { ...json, ...json.data } : json ?? {};
}

export async function createRecurringPlan(body) {
	const json = await request("POST", `${versionPath("v1")}/recurring/plans`, body);
	const plan = unwrap(json);
	return {
		id: plan.id ?? plan.plan_id ?? null,
		status: plan.status ?? null,
		redirectUrl: plan.redirect_url ?? null,
		manageUrl: plan.manage_url ?? null,
		raw: json,
	};
}

export async function getRecurringPlan(planId) {
	const json = await request("GET", `${versionPath("v1")}/recurring/plans/${encodeURIComponent(planId)}`);
	const plan = unwrap(json);
	return { id: plan.id ?? planId, status: plan.status ?? null, manageUrl: plan.manage_url ?? null, raw: json };
}
