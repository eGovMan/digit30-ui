import {
	Issuer,
	type BaseClient,
	type UserinfoResponse,
	custom,
	type ClientAuthMethod,
} from "openid-client";
import { addHours } from "date-fns";
import { env } from "$env/dynamic/private";
import { sha256 } from "$lib/utils/sha256";
import { z } from "zod";
import { dev } from "$app/environment";
import type { Cookies } from "@sveltejs/kit";
import { collections } from "$lib/server/database";
import { logger } from "$lib/server/logger";
import type { User } from "$lib/types/User";
import { addWeeks } from "date-fns";

// Define interfaces for OIDC settings and user info
export interface OIDCSettings {
	redirectURI: string;
}

export interface OIDCUserInfo {
	userData: UserinfoResponse;
	accessToken: string;
	refreshToken: string;
	expiresIn: number;
}
// No hardcoded requirement for user authentication
export const requiresUser = true;

// Cookie settings
const sameSite = z
	.enum(["lax", "none", "strict"])
	.default(dev || env.ALLOW_INSECURE_COOKIES === "true" ? "lax" : "none")
	.parse(env.COOKIE_SAMESITE === "" ? undefined : env.COOKIE_SAMESITE);

const secure = z
	.boolean()
	.default(!(dev || env.ALLOW_INSECURE_COOKIES === "true"))
	.parse(env.COOKIE_SECURE === "" ? undefined : env.COOKIE_SECURE === "true");

export function refreshSessionCookie(cookies: Cookies, sessionId: string) {
	cookies.set(env.COOKIE_NAME || "hf-chat", sessionId, {
		path: "/",
		sameSite,
		secure,
		httpOnly: true,
		expires: addWeeks(new Date(), 2),
	});
}

// export async function findUser(sessionId: string) {
// 	const session = await collections.sessions.findOne({ sessionId });
// 	return session ? await collections.users.findOne({ _id: session.userId }) : null;
// }

export async function findUser(sessionId: string): Promise<User | null> {
	const session = await collections.sessions.findOne({ sessionId });
	if (!session) {
		console.log("No session found for sessionId:", sessionId);
		return null;
	}

	const userData = "$set" in session ? session.$set : session;
	return {
		...userData,
		sessionId, // include sessionId explicitly
	} as User;
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
	const accountServiceRoute = "/account-service";
	const accountServiceUrl = `${kongProxyUrl}${accountServiceRoute}`;
	const response = await fetch(`${accountServiceUrl}/client/${accountname}`);
	if (!response.ok) {
		throw new Error(`Failed to fetch client details for ${accountname}: ${response.statusText}`);
	}
	const config = await response.json();

	console.log("OIDC config from account service:", config);

	const oidcConfig = z
		.object({
			authUrl: z.string(),
			clientId: z.string(),
			resource: z.string(),
			scopes: z.string(),
			redirectUri: z.string().url(),
			nameClaim: z.string(),
			tolerance: z.string(),
		})
		.parse(config.oidc);

	const baseUrl = oidcConfig.authUrl.split("/protocol/openid-connect")[0];
	const issuerUrl = `${baseUrl}/.well-known/openid-configuration`;
	const issuer = await Issuer.discover(issuerUrl);

	const client_config: {
		client_id: string;
		redirect_uris: string[];
		response_types: string[];
		[custom.clock_tolerance]: string;
		id_token_signed_response_alg: string;
		resource: string;
		token_endpoint_auth_method: ClientAuthMethod;
	} = {
		client_id: env.KEYCLOAK_PUBLIC_CLIENT_ID || oidcConfig.clientId,
		redirect_uris: [settings.redirectURI],
		response_types: ["code"],
		[custom.clock_tolerance]: oidcConfig.tolerance,
		id_token_signed_response_alg: "RS256",
		resource: oidcConfig.resource,
		token_endpoint_auth_method: "none", // Explicitly typed as ClientAuthMethod
	};

	return new issuer.Client(client_config);
}

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

	// Fetch config to get scopes dynamically
	const kongProxyUrl = env.KONG_PROXY_URL || "http://localhost:8000";
	const response = await fetch(`${kongProxyUrl}/account-service/client/${params.accountname}`);
	if (!response.ok) {
		throw new Error(`Failed to fetch config for ${params.accountname}`);
	}
	const config = await response.json();
	console.log(config);
	const oidcConfig = z.object({ scopes: z.string() }).parse(config.oidc);

	return client.authorizationUrl({
		scope: oidcConfig.scopes,
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

	if (!token.access_token || !token.refresh_token || !token.expires_in) {
		throw new Error("Missing token properties");
	}

	console.log("Token Set from Keycloak:", {
		accessToken: token.access_token,
		refreshToken: token.refresh_token,
		expiresIn: token.expires_in,
	});

	return {
		userData: await client.userinfo(token),
		accessToken: token.access_token,
		refreshToken: token.refresh_token,
		expiresIn: token.expires_in,
	};
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
