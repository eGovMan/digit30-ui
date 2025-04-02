// src/routes/login/callback/updateUser.ts
import { refreshSessionCookie } from "$lib/server/auth";
import { collections } from "$lib/server/database";
import { ObjectId } from "mongodb";
import { DEFAULT_SETTINGS } from "$lib/types/Settings";
import { z } from "zod";
import type { UserinfoResponse } from "openid-client";
import { env } from "$env/dynamic/private";
import { logger } from "$lib/server/logger";
import type { Cookies } from "@sveltejs/kit";
export async function updateUser(params: {
	userData?: UserinfoResponse;
	locals: App.Locals;
	cookies: Cookies;
	sessionId: string;
	accountName?: string;
	refreshToken?: string;
	accessToken?: string;
	tokenExpiresIn?: number;
	clientId?: string;
}) {
	const {
		userData,
		locals,
		cookies,
		sessionId,
		accountName,
		refreshToken,
		accessToken,
		tokenExpiresIn,
		clientId,
	} = params;

	let username: string | undefined;
	let name: string | undefined;
	let email: string | undefined;
	let avatarUrl: string | undefined;
	let hfUserId: string | undefined;
	let orgs:
		| Array<{
				sub: string;
				name: string;
				picture: string;
				preferred_username: string;
				isEnterprise: boolean;
		  }>
		| undefined;

	if (userData) {
		if (userData.upn && !userData.preferred_username) {
			userData.preferred_username = userData.upn as string;
		}

		const NAME_CLAIM = "name";

		const parsedUserData = z
			.object({
				preferred_username: z.string().optional(),
				name: z.string(),
				picture: z.string().optional(),
				sub: z.string(),
				email: z.string().email().optional(),
				orgs: z
					.array(
						z.object({
							sub: z.string(),
							name: z.string(),
							picture: z.string(),
							preferred_username: z.string(),
							isEnterprise: z.boolean(),
						})
					)
					.optional(),
			})
			.setKey(NAME_CLAIM, z.string())
			.refine((data) => data.preferred_username || data.email, {
				message: "Either preferred_username or email must be provided by the provider.",
			})
			.transform((data) => ({
				...data,
				name: data[NAME_CLAIM],
			}))
			.parse(userData) as {
			preferred_username?: string;
			email?: string;
			picture?: string;
			sub: string;
			name: string;
			orgs?: Array<{
				sub: string;
				name: string;
				picture: string;
				preferred_username: string;
				isEnterprise: boolean;
			}>;
		} & Record<string, string>;

		username = parsedUserData.preferred_username;
		name = parsedUserData.name;
		email = parsedUserData.email;
		avatarUrl = parsedUserData.picture;
		hfUserId = parsedUserData.sub;
		orgs = parsedUserData.orgs;

		logger.info(
			{
				login_username: username,
				login_name: name,
				login_email: email,
				login_orgs: orgs?.map((el) => el.sub),
			},
			"user login"
		);
		if (accountName) {
			cookies.set("account_info", accountName, {
				path: "/",
				httpOnly: true,
				secure: !import.meta.env.DEV,
				sameSite: "lax",
				maxAge: 30 * 24 * 60 * 60, // 30 days
			});
		}
	}

	//if username is accountName-admin, set isAdmin to true
	const isAdmin =
		username === `${accountName}-admin` ||
		(env.HF_ORG_ADMIN && orgs?.some((org) => org.sub === env.HF_ORG_ADMIN)) ||
		false;
	const isEarlyAccess =
		(env.HF_ORG_EARLY_ACCESS && orgs?.some((org) => org.sub === env.HF_ORG_EARLY_ACCESS)) || false;
	if (hfUserId) {
		logger.debug(
			{
				isAdmin,
				isEarlyAccess,
				hfUserId,
			},
			`Updating user ${hfUserId}`
		);
	}
	// Calculate token expiration date if provided
	const tokenExpiresAt = tokenExpiresIn ? new Date(Date.now() + tokenExpiresIn * 1000) : undefined;

	// Upsert user in the users collection
	let userId;
	let userResult;
	if (hfUserId) {
		userResult = await collections.users.updateOne(
			{ hfUserId },
			{
				$set: {
					username,
					name,
					email,
					accountName,
					avatarUrl,
					isAdmin,
					isEarlyAccess,
					accessToken,
					refreshToken,
					tokenExpiresAt,
					updatedAt: new Date(),
				},
				$setOnInsert: {
					_id: new ObjectId(),
					createdAt: new Date(),
				},
			},
			{ upsert: true }
		);

		userId = userResult.upsertedId || (await collections.users.findOne({ hfUserId }))?._id;
		if (!userId) {
			throw new Error("Failed to retrieve or create user ID");
		}
	} else {
		// For refresh, we need to find the user by sessionId if no userData
		const session = await collections.sessions.findOne({ sessionId });
		if (!session) {
			throw new Error("No session found for refresh");
		}
		userId = session.userId;
	}

	const previousSessionId = locals.sessionId;
	locals.sessionId = sessionId;

	// Upsert session in the sessions collection
	await collections.sessions.updateOne(
		{ sessionId },
		{
			$set: {
				...(username && { username }), // Only set if provided
				...(name && { name }),
				...(email && { email }),
				...(accountName && { accountName }),
				...(avatarUrl && { avatarUrl }),
				...(isAdmin !== undefined && { isAdmin }),
				...(isEarlyAccess !== undefined && { isEarlyAccess }),
				...(accessToken && { accessToken }),
				...(refreshToken && { refreshToken }),
				...(clientId && { clientId }),
				...(tokenExpiresAt && { tokenExpiresAt }),
				updatedAt: new Date(),
			},
			$setOnInsert: {
				_id: new ObjectId(),
				createdAt: new Date(),
			},
		},
		{ upsert: true }
	);

	logger.info("Session saved:", { sessionId, userId, accountName });

	// Clean up previous session if it exists
	if (previousSessionId && previousSessionId !== sessionId) {
		await collections.sessions.deleteOne({ sessionId: previousSessionId });
	}

	// Update settings for new user or migrate from previous session
	const settingsUpdate = await collections.settings.updateOne(
		{ sessionId: previousSessionId },
		{
			$set: { userId, updatedAt: new Date() },
			$unset: { sessionId: "" },
		}
	);

	// Check if this is a new user (upserted) rather than an update
	const isNewUser = userData && !!userResult?.upsertedId;
	if (settingsUpdate.matchedCount === 0 && isNewUser) {
		await collections.settings.insertOne({
			userId,
			ethicsModalAcceptedAt: new Date(),
			updatedAt: new Date(),
			createdAt: new Date(),
			...DEFAULT_SETTINGS,
		});
	}

	// Update conversations from previous session
	await collections.conversations.updateMany(
		{ sessionId: previousSessionId },
		{
			$set: { userId },
			$unset: { sessionId: "" },
		}
	);

	// Refresh session cookie
	refreshSessionCookie(cookies, sessionId);

	if (refreshToken) {
		cookies.set("refresh_token", refreshToken, {
			path: "/",
			httpOnly: true,
			secure: !import.meta.env.DEV, // true in prod, false in dev
			sameSite: "lax", // "lax" is safe for dev; use "none" for cross-site in prod if needed
			maxAge: 60 * 60 * 24 * 30, // 30 days
		});
	}

	logger.info("User and session updated successfully", {
		sessionId,
		userId,
		accountName,
		email,
		accessToken,
		refreshToken,
	});
}
