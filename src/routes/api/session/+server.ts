import { findUser } from "$lib/server/auth";
import { json } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import type { User } from "$lib/types/User";
import { verifyAccessToken } from "$lib/server/token";

export async function GET({ cookies }) {
	const sessionId = cookies.get(env.COOKIE_NAME || "session");
	// console.log("Checking session ID from cookie:", sessionId);

	// console.log("Cookies in session handler:", cookies.getAll());

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

	const realm = user.accountName;

	const verified = await verifyAccessToken(user.accessToken, realm);
	if (!verified) {
		console.log("Access token has expired or is invalid");
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
		clientId: user.clientId,
	});
}
