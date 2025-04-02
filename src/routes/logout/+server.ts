import { dev } from "$app/environment";
import { env } from "$env/dynamic/private";
import { collections } from "$lib/server/database";
import { redirect } from "@sveltejs/kit";

export async function GET({ cookies }) {
	const sessionId = cookies.get(env.COOKIE_NAME || "session");

	if (sessionId) {
		await collections.sessions.deleteOne({ sessionId });
		cookies.delete(env.COOKIE_NAME || "session", {
			path: "/",
			sameSite: dev || env.ALLOW_INSECURE_COOKIES === "true" ? "lax" : "none",
			secure: !dev && !(env.ALLOW_INSECURE_COOKIES === "true"),
			httpOnly: true,
		});
	}

	const user = sessionId ? await collections.sessions.findOne({ sessionId }) : null;
	const realm =
		(user as { accountName?: string } | null)?.accountName ?? cookies.get("account_info") ?? "eGov";
	const clientId = `${realm}-client`;
	const keycloakBaseUrl = env.KEYCLOAK_URL || "http://localhost:8080";
	const keycloakLogoutUrl = `${keycloakBaseUrl}/realms/${realm}/protocol/openid-connect/logout`;
	// const logoutRedirectUri = `${base}/login/callback`;
	const redirectUri = `http://localhost:5173/`;

	cookies.delete("refresh_token", { path: "/" });
	cookies.delete("account_info", { path: "/" });

	const logoutUrl = `${keycloakLogoutUrl}?post-logout-redirect_uri=${encodeURIComponent(redirectUri)}&client_id=${clientId}`;
	console.log("Logout URL:", logoutUrl);

	throw redirect(303, logoutUrl);
}

export async function POST({ cookies }) {
	const sessionId = cookies.get(env.COOKIE_NAME || "session");

	if (sessionId) {
		await collections.sessions.deleteOne({ sessionId });
		cookies.delete(env.COOKIE_NAME || "session", {
			path: "/",
			sameSite: dev || env.ALLOW_INSECURE_COOKIES === "true" ? "lax" : "none",
			secure: !dev && !(env.ALLOW_INSECURE_COOKIES === "true"),
			httpOnly: true,
		});
	}

	const user = sessionId ? await collections.sessions.findOne({ sessionId }) : null;
	const realm =
		(user as { accountName?: string } | null)?.accountName ?? cookies.get("account_info") ?? "eGov";
	const clientId = `${realm}-client`;
	const keycloakBaseUrl = env.KEYCLOAK_URL || "http://localhost:8080";
	const keycloakLogoutUrl = `${keycloakBaseUrl}/realms/${realm}/protocol/openid-connect/logout`;
	// const logoutRedirectUri = `${base}/login/callback`;
	const redirectUri = `http://localhost:5173/`;

	cookies.delete("refresh_token", { path: "/" });
	cookies.delete("account_info", { path: "/" });

	const logoutUrl = `${keycloakLogoutUrl}?post-logout-redirect_uri=${encodeURIComponent(redirectUri)}&client_id=${clientId}`;
	console.log("Logout URL:", logoutUrl);

	throw redirect(303, logoutUrl);
}
