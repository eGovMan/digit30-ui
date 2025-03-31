import { redirect, error } from "@sveltejs/kit";
import { getOIDCUserData, validateAndParseCsrfToken } from "$lib/server/auth";
import { z } from "zod";
import { base } from "$app/paths";
import { updateUser } from "./updateUser";
import { env } from "$env/dynamic/private";
import JSON5 from "json5";

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

	console.log("Callback received - state:", state);

	const csrfTokenBase64 = Buffer.from(state, "base64").toString("utf-8");
	console.log("Decoded CSRF token (base64):", csrfTokenBase64);

	const sessionId = cookies.get("temp_session_id");
	if (!sessionId) {
		error(403, "No session ID found for CSRF validation");
	}

	const validatedToken = await validateAndParseCsrfToken(csrfTokenBase64, sessionId);
	if (!validatedToken) {
		error(403, "Invalid or expired CSRF token");
	}
	const accountName = validatedToken.realm; // Extract from state
	console.log("Account name extracted from state:", accountName);

	// Get user data and tokens from Keycloak
	const { userData, accessToken, refreshToken, expiresIn } = await getOIDCUserData(
		{ redirectURI: validatedToken.redirectUrl },
		code,
		iss,
		request
	);

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

	// Pass accountname along with other data to updateUser
	await updateUser({
		userData,
		locals,
		cookies,
		userAgent: request.headers.get("user-agent") ?? undefined,
		ip: getClientAddress(),
		sessionId,
		accountName,
		refreshToken,
		accessToken,
		tokenExpiresIn: expiresIn,
	});

	// Set session cookie
	cookies.set("session", sessionId, {
		path: "/",
		httpOnly: true,
		secure: !import.meta.env.DEV,
	});

	// Store refresh token in a separate httpOnly cookie
	cookies.set("refresh_token", refreshToken, {
		path: "/",
		httpOnly: true,
		secure: !import.meta.env.DEV,
		maxAge: 30 * 24 * 60 * 60, // 30 days, adjust based on Keycloak config
	});

	cookies.delete("temp_session_id", { path: "/" });

	console.log("User logged in:", {
		username: userData.username,
		email: userData.email,
		accountName,
	});

	throw redirect(302, `${base}/`);
}
