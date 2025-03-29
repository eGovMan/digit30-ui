// src/routes/api/session/+server.ts
import { findUser } from "$lib/server/auth";
import { json } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";

export async function GET({ cookies }) {
	const sessionId = cookies.get(env.COOKIE_NAME || "session");
	console.log("Checking session ID from cookie:", sessionId);

	if (!sessionId) {
		console.log("No session ID found in cookies");
		return new Response(null, { status: 401 });
	}

	const user = await findUser(sessionId);
	console.log("User found for session:", user);

	if (!user) {
		console.log("No user found for session ID:", sessionId);
		return new Response(null, { status: 401 });
	}

	console.log("Session validated successfully");
	return json({ authenticated: true, user });
}
