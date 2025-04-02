// src/routes/api/refresh/+server.ts
import { json } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import { updateUser } from "../../login/callback/updateUser";

export async function POST({ cookies, locals }) {
	const refreshToken = cookies.get("refresh_token");
	const sessionId = cookies.get("session");

	console.log("Refreshing token for session:", sessionId);

	if (!refreshToken || !sessionId) {
		cookies.delete("session", { path: "/" });
		cookies.delete("refresh_token", { path: "/" });
		return json({ error: "No refresh token or session found" }, { status: 401 });
	}

	const keycloakUrl = env.KEYCLOAK_URL || "http://localhost:8080";
	let accountName = locals?.user?.accountName;
	if (!accountName) {
		accountName = cookies.get("account_info");
		if (!accountName) {
			console.error("Missing accountName in session and cookie");
			return json({ error: "Missing accountName for client ID" }, { status: 500 });
		}
	}
	const clientId = `${accountName}-client`;

	const response = await fetch(`${keycloakUrl}/protocol/openid-connect/token`, {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
		},
		body: new URLSearchParams({
			grant_type: "refresh_token",
			refresh_token: refreshToken,
			client_id: clientId,
		}),
	});

	if (!response.ok) {
		cookies.delete("session", { path: "/" });
		cookies.delete("refresh_token", { path: "/" });
		const errorText = await response.text();
		console.error("❌ Refresh failed with response:", errorText);
		return json({ error: "Failed to refresh token" }, { status: 401 });
	}

	const { access_token, refresh_token, expires_in } = await response.json();

	await updateUser({
		locals,
		cookies,
		sessionId,
		accessToken: access_token,
		refreshToken: refresh_token,
		tokenExpiresIn: expires_in,
		clientId,
	});

	cookies.set("refresh_token", refresh_token, {
		path: "/",
		httpOnly: true,
		secure: !import.meta.env.DEV,
		maxAge: 30 * 24 * 60 * 60,
	});

	return json({ success: true, expiresIn: expires_in });
}
