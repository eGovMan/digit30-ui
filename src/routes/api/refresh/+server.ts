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
	const clientId = env.KEYCLOAK_PUBLIC_CLIENT_ID || "eGov-client";
	const clientSecret = env.KEYCLOAK_SERVER_CLIENT_SECRET || "";

	const response = await fetch(`${keycloakUrl}/protocol/openid-connect/token`, {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
		},
		body: new URLSearchParams({
			grant_type: "refresh_token",
			refresh_token: refreshToken,
			client_id: clientId,
			client_secret: clientSecret,
		}),
	});

	if (!response.ok) {
		cookies.delete("session", { path: "/" });
		cookies.delete("refresh_token", { path: "/" });
		console.log("Refresh failed, clearing session");
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
	});

	cookies.set("refresh_token", refresh_token, {
		path: "/",
		httpOnly: true,
		secure: !import.meta.env.DEV,
		maxAge: 30 * 24 * 60 * 60,
	});

	return json({ success: true, expiresIn: expires_in });
}
