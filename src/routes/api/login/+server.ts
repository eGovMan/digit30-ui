// src/routes/api/login/+server.ts
import { getOIDCAuthorizationUrl } from "$lib/server/auth";
import { json } from "@sveltejs/kit";

export async function GET({ url, cookies }) {
	const accountname = url.searchParams.get("accountname");
	if (!accountname) {
		return new Response("Account name is required", { status: 400 });
	}

	const sessionId = crypto.randomUUID();
	const redirectURI = process.env.OPENID_CONFIG
		? JSON.parse(process.env.OPENID_CONFIG).REDIRECT_URI
		: undefined;
	if (!redirectURI) {
		return new Response("REDIRECT_URI is not configured", { status: 500 });
	}

	try {
		const authUrl = await getOIDCAuthorizationUrl({ redirectURI }, { sessionId, accountname });
		// Set sessionId in a cookie
		cookies.set("temp_session_id", sessionId, {
			path: "/",
			httpOnly: true,
			secure: !import.meta.env.DEV, // Secure in prod, not in dev
			maxAge: 60 * 60, // 1 hour
		});
		return json({ authUrl });
	} catch (err) {
		console.error("Error generating auth URL:", err);
		return new Response("Failed to generate authorization URL", { status: 500 });
	}
}
