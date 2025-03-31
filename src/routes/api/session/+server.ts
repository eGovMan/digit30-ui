// src/routes/api/session/+server.ts
import { findUser } from "$lib/server/auth";
import { json } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import type { User } from "$lib/types/User";

export async function GET({ cookies }) {
	const sessionId = cookies.get(env.COOKIE_NAME || "session");
	// console.log("Checking session ID from cookie:", sessionId);

	if (!sessionId) {
		console.log("No session ID found in cookies");
		return new Response(null, { status: 401 });
	}

	const user: User | null = await findUser(sessionId);
	// console.log("User found for session:", JSON.stringify(user, null, 2));

	if (!user || !user.accessToken) {
		// console.log("No user or access token found for session ID:", sessionId);
		return new Response(null, { status: 401 });
	}

	const keycloakUrl = env.KEYCLOAK_URL || "http://localhost:8080";
	const realm = user.accountName || "eGov";
	const clientId = env.KEYCLOAK_SERVER_CLIENT_ID || "eGov-server"; // Use server client
	const clientSecret = env.KEYCLOAK_SERVER_CLIENT_SECRET || "";

	const introspectUrl = `${keycloakUrl}/realms/${realm}/protocol/openid-connect/token/introspect`;
	// console.log("Introspecting token at:", introspectUrl, "with token:", user.accessToken);

	const introspectResponse = await fetch(introspectUrl, {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
		},
		body: new URLSearchParams({
			token: user.accessToken,
			client_id: clientId,
			client_secret: clientSecret,
		}),
	});

	if (!introspectResponse.ok) {
		const errorText = await introspectResponse.text();
		console.log("Token introspection failed:", introspectResponse.status, errorText);
		return new Response(null, { status: 401 });
	}

	const introspectData = await introspectResponse.json();
	// console.log("Introspection result:", JSON.stringify(introspectData, null, 2));

	if (!introspectData.active) {
		// console.log("Access token is not active for session ID:", sessionId);
		return new Response(null, { status: 401 });
	}

	// console.log("Session validated successfully with active token");
	return json({
		authenticated: true,
		user: {
			accountName: user.accountName,
			email: user.email,
		},
		refreshToken: user.refreshToken,
	});
}
