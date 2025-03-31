import { dev } from "$app/environment";
import { base } from "$app/paths";
import { env } from "$env/dynamic/private";
import { collections } from "$lib/server/database";
import { redirect } from "@sveltejs/kit";

export async function POST({ cookies, locals }) {
	await collections.sessions.deleteOne({ sessionId: locals.sessionId });

	cookies.delete(env.COOKIE_NAME, {
		path: "/",
		sameSite: dev || env.ALLOW_INSECURE_COOKIES === "true" ? "lax" : "none",
		secure: !dev && !(env.ALLOW_INSECURE_COOKIES === "true"),
		httpOnly: true,
	});

	const keycloakLogoutUrl = "http://localhost:8080/realms/eGov/protocol/openid-connect/logout";
	const redirectUri = `${base}/`;
	const logoutUrl = `${keycloakLogoutUrl}?post_logout_redirect_uri=${encodeURIComponent(redirectUri)}&client_id=eGov-client`;

	throw redirect(303, logoutUrl);
}
