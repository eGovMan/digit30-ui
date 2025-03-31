import type { ObjectId } from "mongodb";
import type { Timestamps } from "./Timestamps";

export interface User extends Timestamps {
	_id: ObjectId;
	hfUserId: string; // Keycloak sub
	username: string;
	name: string;
	email?: string;
	accountName?: string;
	accessToken?: string; // Added for Keycloak access token
	refreshToken?: string; // Added for Keycloak refresh token
	tokenExpiresAt?: Date; // Added for token expiration
	avatarUrl?: string;
	isAdmin: boolean;
	isEarlyAccess: boolean;
}
