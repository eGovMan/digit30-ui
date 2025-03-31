import { json } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import { updateUser } from "../../login/callback/updateUser";

export async function POST({ cookies, locals }) {
	const refreshToken = cookies.get("refresh_token");
	const sessionId = cookies.get("session");

	if (!refreshToken || !sessionId) {
		return json({ error: "No refresh token or session found" }, { status: 401 });
	}

	// Keycloak token refresh endpoint
	const keycloakUrl = env.KEYCLOAK_URL || "http://localhost:8080"; // Set in .env
	const clientId = env.KEYCLOAK_CLIENT_ID; // Set in .env
	const clientSecret = env.KEYCLOAK_CLIENT_SECRET; // Set in .env (if applicable)

	const response = await fetch(`${keycloakUrl}/protocol/openid-connect/token`, {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
		},
		body: new URLSearchParams({
			grant_type: "refresh_token",
			refresh_token: refreshToken,
			client_id: clientId,
			client_secret: clientSecret || "",
		}),
	});

	if (!response.ok) {
		return json({ error: "Failed to refresh token" }, { status: 401 });
	}

	const { access_token, refresh_token, expires_in } = await response.json();

	// Update user session with new tokens
	await updateUser({
		locals,
		cookies,
		sessionId,
		accessToken: access_token,
		refreshToken: refresh_token,
		tokenExpiresIn: expires_in,
	});

	// Update refresh token cookie
	cookies.set("refresh_token", refresh_token, {
		path: "/",
		httpOnly: true,
		secure: !import.meta.env.DEV,
		maxAge: 30 * 24 * 60 * 60, // 30 days
	});

	return json({ success: true, expiresIn: expires_in });
}
