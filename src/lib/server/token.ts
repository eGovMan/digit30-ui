import { jwtVerify, createRemoteJWKSet, type JWTVerifyResult } from "jose";

const JWKS_CACHE = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export async function verifyAccessToken(
	token: string,
	realm: string
): Promise<JWTVerifyResult | null> {
	const keycloakUrl = process.env.KEYCLOAK_URL || "http://localhost:8080";
	const jwksUri = `${keycloakUrl}/realms/${realm}/protocol/openid-connect/certs`;

	// Cache the JWKS fetcher
	let getKeySet = JWKS_CACHE.get(jwksUri);
	if (!getKeySet) {
		getKeySet = createRemoteJWKSet(new URL(jwksUri));
		JWKS_CACHE.set(jwksUri, getKeySet);
	}

	try {
		// Verify token
		return await jwtVerify(token, getKeySet, {
			issuer: `${keycloakUrl}/realms/${realm}`,
		});
	} catch (err: unknown) {
		const maybeError = err as unknown as Record<string, unknown>;
		if (
			err instanceof Error &&
			typeof maybeError.code === "string" &&
			maybeError.code === "ERR_JWT_EXPIRED"
		) {
			console.warn("Access token expired:", err);
			return null;
		}
		console.error("Access token verification failed:", err);
		throw err;
	}
}
