// src/routes/api/login/+server.ts
import { getOIDCAuthorizationUrl } from "$lib/server/auth";
import { json } from "@sveltejs/kit";

export async function GET({ url, cookies }) {
	const accountname = url.searchParams.get("accountname");
	const sessionId = url.searchParams.get("sessionId") || crypto.randomUUID();

	if (!accountname) {
		return new Response("Account name is required", { status: 400 });
	}

	const redirectURI = "http://localhost:5173/login/callback"; // Match Vite dev server port

	try {
		const authUrl = await getOIDCAuthorizationUrl({ redirectURI }, { sessionId, accountname });
		cookies.set("temp_session_id", sessionId, {
			path: "/",
			httpOnly: true,
			secure: !import.meta.env.DEV,
			maxAge: 60 * 60, // 1 hour
		});
		return json({ authUrl });
	} catch (err) {
		console.error("Error generating auth URL:", err);
		return new Response("Failed to generate authorization URL", { status: 500 });
	}
}
