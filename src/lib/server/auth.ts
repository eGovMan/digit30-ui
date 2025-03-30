import {
	Issuer,
	type BaseClient,
	type UserinfoResponse,
	type TokenSet,
	custom,
} from "openid-client";
import { addHours, addWeeks } from "date-fns";
import { env } from "$env/dynamic/private";
import { sha256 } from "$lib/utils/sha256";
import { z } from "zod";
import { dev } from "$app/environment";
import type { Cookies } from "@sveltejs/kit";
import { collections } from "$lib/server/database";
import JSON5 from "json5";
import { logger } from "$lib/server/logger";

export interface OIDCSettings {
	redirectURI: string;
}

export interface OIDCUserInfo {
	token: TokenSet;
	userData: UserinfoResponse;
}

// const stringWithDefault = (value?: string) =>
//     z.string().transform((el) => el || value);

// Define OIDC config schema without defaults or fallbacks
export const OIDConfig = z
	.object({
		SCOPES: z.string(),
		REDIRECT_URI: z.string().url(),
		NAME_CLAIM: z
			.string()
			.refine((el) => !["preferred_username", "email", "picture", "sub"].includes(el), {
				message: "nameClaim cannot be one of the restricted keys.",
			}),
		TOLERANCE: z.string(),
		ID_TOKEN_SIGNED_RESPONSE_ALG: z.string().optional(),
	})
	.parse(JSON5.parse(env.OPENID_CONFIG || "{}"));

// No hardcoded requirement for user authentication
export const requiresUser = true;

const sameSite = z
	.enum(["lax", "none", "strict"])
	.default(dev || env.ALLOW_INSECURE_COOKIES === "true" ? "lax" : "none")
	.parse(env.COOKIE_SAMESITE === "" ? undefined : env.COOKIE_SAMESITE);

const secure = z
	.boolean()
	.default(!(dev || env.ALLOW_INSECURE_COOKIES === "true"))
	.parse(env.COOKIE_SECURE === "" ? undefined : env.COOKIE_SECURE === "true");

export function refreshSessionCookie(cookies: Cookies, sessionId: string) {
	cookies.set(env.COOKIE_NAME, sessionId, {
		path: "/",
		sameSite,
		secure,
		httpOnly: true,
		expires: addWeeks(new Date(), 2),
	});
}

export async function findUser(sessionId: string) {
	const session = await collections.sessions.findOne({ sessionId });
	return session ? await collections.users.findOne({ _id: session.userId }) : null;
}

export const authCondition = (locals: App.Locals) => {
	return locals.user
		? { userId: locals.user._id }
		: { sessionId: locals.sessionId, userId: { $exists: false } };
};

export async function generateCsrfToken(
	sessionId: string,
	redirectUrl: string,
	accountname: string
): Promise<string> {
	const data = {
		expiration: addHours(new Date(), 1).getTime(),
		redirectUrl,
		realm: accountname,
	};
	return Buffer.from(
		JSON.stringify({
			data,
			signature: await sha256(JSON.stringify(data) + "##" + sessionId),
		})
	).toString("base64");
}

async function getOIDCClient(settings: OIDCSettings, accountname: string): Promise<BaseClient> {
	if (!accountname) {
		throw new Error("Account name is required to fetch OIDC client details");
	}

	const kongProxyUrl = env.KONG_PROXY_URL || "http://localhost:8000";
	if (!kongProxyUrl) {
		throw new Error("KONG_PROXY_URL is not defined in environment variables");
	}
	const accountServiceRoute = "/account-service";
	const accountServiceUrl = `${kongProxyUrl}${accountServiceRoute}`;

	const response = await fetch(`${accountServiceUrl}/client/${accountname}`);
	if (!response.ok) {
		throw new Error(`Failed to fetch client details for ${accountname}: ${response.statusText}`);
	}
	const { realm, client_id, resource } = await response.json();

	const keycloakBaseUrl = env.KEYCLOAK_BASE_URL;
	if (!keycloakBaseUrl) {
		throw new Error("KEYCLOAK_BASE_URL is not defined in environment variables");
	}
	const issuerUrl = `${keycloakBaseUrl}/realms/${realm}`;
	const issuer = await Issuer.discover(issuerUrl);

	const client_config = {
		client_id,
		redirect_uris: [settings.redirectURI],
		response_types: ["code"],
		[custom.clock_tolerance]: OIDConfig.TOLERANCE,
		id_token_signed_response_alg: OIDConfig.ID_TOKEN_SIGNED_RESPONSE_ALG,
		resource,
		token_endpoint_auth_method: "none",
	};

	const alg_supported = issuer.metadata["id_token_signing_alg_values_supported"];
	if (Array.isArray(alg_supported) && !client_config.id_token_signed_response_alg) {
		client_config.id_token_signed_response_alg = alg_supported[0];
	}

	return new issuer.Client(client_config);
}

/*************  ✨ Codeium Command ⭐  *************/
/**
 * Generates the OpenID Connect authorization URL.
 * @param params - An object containing the session ID and account name.

 * @returns A promise that resolves to the authorization URL.
 *
 * This function retrieves an OIDC client for the specified account name,
 * generates a CSRF token, and constructs the authorization URL with the
 * necessary scopes and state.
 */

/******  0ad0415f-a3b4-4390-abf8-f7b79240e93c  *******/
export async function getOIDCAuthorizationUrl(
	settings: OIDCSettings,
	params: { sessionId: string; accountname: string }
): Promise<string> {
	const client = await getOIDCClient(settings, params.accountname);
	const csrfToken = await generateCsrfToken(
		params.sessionId,
		settings.redirectURI,
		params.accountname
	);

	return client.authorizationUrl({
		scope: OIDConfig.SCOPES,
		state: csrfToken,
	});
}

export async function getOIDCUserData(
	settings: OIDCSettings,
	code: string,
	iss?: string,
	request?: Request
): Promise<OIDCUserInfo> {
	if (!request) {
		throw new Error("Request object is required to extract accountname from state");
	}

	const url = new URL(request.url);
	const state = url.searchParams.get("state");
	if (!state) {
		throw new Error("State parameter is missing in callback URL");
	}

	let accountname;
	try {
		const decodedState = JSON.parse(Buffer.from(state, "base64").toString());
		accountname = decodedState.data?.realm;
		if (!accountname) {
			throw new Error("Accountname (realm) not found in state");
		}
	} catch (e) {
		logger.error("Failed to parse state:", e);
		throw new Error("Invalid state parameter");
	}

	const client = await getOIDCClient(settings, accountname);
	const token = await client.callback(settings.redirectURI, { code, iss });
	const userData = await client.userinfo(token);

	return { token, userData };
}

export async function validateAndParseCsrfToken(
	token: string,
	sessionId: string
): Promise<{
	redirectUrl: string;
	realm?: string;
} | null> {
	try {
		const { data, signature } = z
			.object({
				data: z.object({
					expiration: z.number().int(),
					redirectUrl: z.string().url(),
					realm: z.string().optional(),
				}),
				signature: z.string().length(64),
			})
			.parse(JSON.parse(token));
		const reconstructSign = await sha256(JSON.stringify(data) + "##" + sessionId);

		if (data.expiration > Date.now() && signature === reconstructSign) {
			return { redirectUrl: data.redirectUrl, realm: data.realm };
		}
	} catch (e) {
		logger.error(e);
	}
	return null;
}
