// src/routes/login/callback/updateUser.ts
import { refreshSessionCookie } from "$lib/server/auth";
import { collections } from "$lib/server/database";
import { ObjectId } from "mongodb";
import { DEFAULT_SETTINGS } from "$lib/types/Settings";
import { z } from "zod";
import type { UserinfoResponse } from "openid-client";
import { addWeeks } from "date-fns";
import { env } from "$env/dynamic/private";
import { logger } from "$lib/server/logger";

export async function updateUser(params: {
	userData: UserinfoResponse;
	locals: App.Locals;
	cookies: Cookies;
	userAgent?: string;
	ip?: string;
	sessionId: string;
	accountName?: string;
	refreshToken?: string; // Add refresh token
	accessToken?: string; // Add access token
	tokenExpiresIn?: number; // Add expiration time in seconds
}) {
	const {
		userData,
		locals,
		cookies,
		userAgent,
		ip,
		sessionId,
		accountName,
		refreshToken,
		accessToken,
		tokenExpiresIn,
	} = params;

	if (userData.upn && !userData.preferred_username) {
		userData.preferred_username = userData.upn as string;
	}

	const NAME_CLAIM = "name"; // Fallback; ideally fetch from oidcConfig

	const {
		preferred_username: username,
		name,
		email,
		picture: avatarUrl,
		sub: hfUserId,
		orgs,
	} = z
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

	logger.info(
		{
			login_username: username,
			login_name: name,
			login_email: email,
			login_orgs: orgs?.map((el) => el.sub),
		},
		"user login"
	);

	const isAdmin = (env.HF_ORG_ADMIN && orgs?.some((org) => org.sub === env.HF_ORG_ADMIN)) || false;
	const isEarlyAccess =
		(env.HF_ORG_EARLY_ACCESS && orgs?.some((org) => org.sub === env.HF_ORG_EARLY_ACCESS)) || false;

	logger.debug(
		{
			isAdmin,
			isEarlyAccess,
			hfUserId,
		},
		`Updating user ${hfUserId}`
	);

	const existingUser = await collections.users.findOne({ hfUserId });
	let userId = existingUser?._id;

	const previousSessionId = locals.sessionId;
	locals.sessionId = sessionId;

	// Calculate token expiration date if provided
	const tokenExpiresAt = tokenExpiresIn ? new Date(Date.now() + tokenExpiresIn * 1000) : undefined;

	if (existingUser) {
		await collections.users.updateOne(
			{ _id: existingUser._id },
			{ $set: { username, name, avatarUrl, isAdmin, isEarlyAccess } }
		);

		await collections.sessions.deleteOne({ sessionId: previousSessionId });
		await collections.sessions.insertOne({
			_id: new ObjectId(),
			sessionId: locals.sessionId,
			userId: existingUser._id,
			createdAt: new Date(),
			updatedAt: new Date(),
			userAgent,
			ip,
			expiresAt: addWeeks(new Date(), 2), // Session cookie expiration
			accountName,
			accessToken, // Store access token
			refreshToken, // Store refresh token
			tokenExpiresAt, // Store token expiration
		});
	} else {
		const { insertedId } = await collections.users.insertOne({
			_id: new ObjectId(),
			createdAt: new Date(),
			updatedAt: new Date(),
			username,
			name,
			email,
			accountName,
			avatarUrl,
			hfUserId,
			isAdmin,
			isEarlyAccess,
		});

		userId = insertedId;

		await collections.sessions.insertOne({
			_id: new ObjectId(),
			sessionId: locals.sessionId,
			userId,
			createdAt: new Date(),
			updatedAt: new Date(),
			userAgent,
			ip,
			expiresAt: addWeeks(new Date(), 2),
			accountName,
			accessToken,
			refreshToken,
			tokenExpiresAt,
		});

		const { matchedCount } = await collections.settings.updateOne(
			{ sessionId: previousSessionId },
			{
				$set: { userId, updatedAt: new Date() },
				$unset: { sessionId: "" },
			}
		);

		if (!matchedCount) {
			await collections.settings.insertOne({
				userId,
				ethicsModalAcceptedAt: new Date(),
				updatedAt: new Date(),
				createdAt: new Date(),
				...DEFAULT_SETTINGS,
			});
		}
	}

	refreshSessionCookie(cookies, sessionId);

	await collections.conversations.updateMany(
		{ sessionId: previousSessionId },
		{
			$set: { userId },
			$unset: { sessionId: "" },
		}
	);
}
