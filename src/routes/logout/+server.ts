import { dev } from "$app/environment";
import { base } from "$app/paths";
import { env } from "$env/dynamic/private";
import { collections } from "$lib/server/database";
import { redirect } from "@sveltejs/kit";

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

	const user = await collections.sessions.findOne({ sessionId });
	const realm = (user as { accountName?: string } | null)?.accountName || "eGov";
	const keycloakBaseUrl = env.KEYCLOAK_URL || "http://localhost:8080";
	const keycloakLogoutUrl = `${keycloakBaseUrl}/realms/${realm}/protocol/openid-connect/logout`;
	// const logoutRedirectUri = `${base}/login/callback`;
	const redirectUri = `${base}/login/callback`;

	const logoutUrl = `${keycloakLogoutUrl}?redirect_uri=${encodeURIComponent(redirectUri)}&client_id=eGov-client`;
	console.log(logoutUrl);
	throw redirect(303, logoutUrl);
}
