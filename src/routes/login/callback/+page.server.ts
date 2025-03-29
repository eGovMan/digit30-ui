import { redirect, error } from "@sveltejs/kit";
import { getOIDCUserData, validateAndParseCsrfToken } from "$lib/server/auth";
import { z } from "zod";
import { base } from "$app/paths";
import { updateUser } from "./updateUser";
import { env } from "$env/dynamic/private";
import JSON5 from "json5";
// import { collections } from "$lib/server/database";

const allowedUserEmails = z
	.array(z.string().email())
	.optional()
	.default([])
	.parse(JSON5.parse(env.ALLOWED_USER_EMAILS));

const allowedUserDomains = z
	.array(z.string().regex(/\.\w+$/))
	.optional()
	.default([])
	.parse(JSON5.parse(env.ALLOWED_USER_DOMAINS));

export async function load({ url, locals, cookies, request, getClientAddress }) {
	const { error: errorName, error_description: errorDescription } = z
		.object({
			error: z.string().optional(),
			error_description: z.string().optional(),
		})
		.parse(Object.fromEntries(url.searchParams.entries()));

	if (errorName) {
		error(400, errorName + (errorDescription ? ": " + errorDescription : ""));
	}

	const { code, state, iss } = z
		.object({
			code: z.string(),
			state: z.string(),
			iss: z.string().optional(),
		})
		.parse(Object.fromEntries(url.searchParams.entries()));

	console.log("Callback received - state:", state); // Log raw state

	const csrfTokenBase64 = Buffer.from(state, "base64").toString("utf-8");
	console.log("Decoded CSRF token (base64):", csrfTokenBase64); // Log decoded state

	const sessionId = cookies.get("temp_session_id");
	if (!sessionId) {
		error(403, "No session ID found for CSRF validation");
	}

	const validatedToken = await validateAndParseCsrfToken(csrfTokenBase64, sessionId);
	if (!validatedToken) {
		error(403, "Invalid or expired CSRF token");
	}
	console.log("Validated CSRF token:", validatedToken); // Log parsed token

	const { userData } = await getOIDCUserData(
		{ redirectURI: validatedToken.redirectUrl },
		code,
		iss,
		request
	);
	console.log("User data from Keycloak:", userData); // Log user data

	// Filter by allowed user emails or domains
	if (allowedUserEmails.length > 0 || allowedUserDomains.length > 0) {
		if (!userData.email) {
			error(403, "User not allowed: email not returned");
		}
		const emailVerified = userData.email_verified ?? true;
		if (!emailVerified) {
			error(403, "User not allowed: email not verified");
		}

		const emailDomain = userData.email.split("@")[1];
		const isEmailAllowed = allowedUserEmails.includes(userData.email);
		const isDomainAllowed = allowedUserDomains.includes(`.${emailDomain}`);

		if (!isEmailAllowed && !isDomainAllowed) {
			error(403, "User not allowed");
		}
	}

	// Pass sessionId to updateUser
	await updateUser({
		userData,
		locals,
		cookies,
		userAgent: request.headers.get("user-agent") ?? undefined,
		ip: getClientAddress(),
		sessionId, // Pass the original sessionId
	});

	// Session already inserted by updateUser, just set the cookie
	cookies.set("session", sessionId, {
		path: "/",
		httpOnly: true,
		secure: !import.meta.env.DEV,
	});
	cookies.delete("temp_session_id", { path: "/" });

	// Log successful login (moved from user.set)
	console.log("User logged in:", {
		username: userData.username,
		email: userData.email,
	});

	throw redirect(302, `${base}/`);
}
