// src/lib/stores/accountSettings.ts
import { browser } from "$app/environment";
import { type Writable, writable, get } from "svelte/store";

type OidcConfig = {
	scopes: string;
	authUrl: string;
	clientId: string;
	resource: string;
	nameClaim: string;
	tolerance: string;
	redirectUri: string;
};

type Model = {
	name: string;
	endpoints: { type: string; baseURL?: string }[];
	description: string;
	promptExamples?: { title: string; prompt: string }[];
};

type TextEmbeddingModel = {
	name: string;
	endpoints: { type: string }[];
	description: string;
	displayName: string;
	chunkCharLength: number;
};

type AccountSettingsStore = {
	accountname: string;
	adminEmail: string | null; // Now nullable to match DB
	adminPhone: string | null; // Now nullable to match DB
	oidc: OidcConfig | null;
	models: Model[];
	textEmbeddingModels: TextEmbeddingModel[];
	loading: boolean;
	error: string | null;
	saving: boolean;
	saveError: string | null;
};

type AccountSettingsStoreWritable = Writable<AccountSettingsStore> & {
	fetchAccount: (accountname: string, kongProxyUrl: string) => Promise<void>;
	saveAccount: (accountname: string, kongProxyUrl: string) => Promise<void>;
};

export function createAccountSettingsStore(initialValue: Partial<AccountSettingsStore> = {}) {
	const defaultValue: AccountSettingsStore = {
		accountname: "",
		adminEmail: null,
		adminPhone: null,
		oidc: null,
		models: [],
		textEmbeddingModels: [],
		loading: false,
		error: null,
		saving: false,
		saveError: null,
		...initialValue,
	};

	const baseStore = writable(defaultValue);

	async function fetchAccount(accountname: string, kongProxyUrl: string) {
		if (!browser) return;

		baseStore.update((s) => ({ ...s, loading: true, error: null }));

		try {
			console.log("Fetching account config for:", kongProxyUrl, accountname);
			const response = await fetch(`${kongProxyUrl}/account-service/client/${accountname}`);
			if (!response.ok) {
				throw new Error(`Failed to fetch account details: ${response.statusText}`);
			}

			const accountConfig = await response.json();
			console.log("Fetched account config:", accountConfig);

			baseStore.update((s) => ({
				...s,
				accountname: accountConfig.accountname,
				adminEmail: accountConfig.adminEmail,
				adminPhone: accountConfig.adminPhone,
				oidc: accountConfig.oidc || null,
				models: accountConfig.models || [],
				textEmbeddingModels: accountConfig.textEmbeddingModels || [],
				loading: false,
				error: null,
			}));
		} catch (err) {
			console.error("Fetch error:", err);
			baseStore.update((s) => ({
				...s,
				loading: false,
				error: err instanceof Error ? err.message : "Unknown error",
			}));
		}
	}

	async function saveAccount(accountname: string, kongProxyUrl: string) {
		if (!browser) return;

		baseStore.update((s) => ({ ...s, saving: true, saveError: null }));

		try {
			const currentState = get(baseStore);
			const payload = {
				adminEmail: currentState.adminEmail,
				adminPhone: currentState.adminPhone,
				oidc: currentState.oidc,
				models: currentState.models,
				textEmbeddingModels: currentState.textEmbeddingModels,
			};

			console.log("Saving account config:", payload);

			const response = await fetch(`${kongProxyUrl}/account-service/client/${accountname}`, {
				method: "PUT",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify(payload),
			});

			if (!response.ok) {
				throw new Error(`Failed to save account details: ${response.statusText}`);
			}

			const updatedConfig = await response.json();
			console.log("Saved account config:", updatedConfig);

			baseStore.update((s) => ({
				...s,
				adminEmail: updatedConfig.adminEmail,
				adminPhone: updatedConfig.adminPhone,
				oidc: updatedConfig.oidc || s.oidc,
				models: updatedConfig.models || s.models,
				textEmbeddingModels: updatedConfig.textEmbeddingModels || s.textEmbeddingModels,
				saving: false,
				saveError: null,
			}));
		} catch (err) {
			console.error("Save error:", err);
			baseStore.update((s) => ({
				...s,
				saving: false,
				saveError: err instanceof Error ? err.message : "Unknown error",
			}));
		}
	}

	return {
		subscribe: baseStore.subscribe,
		set: baseStore.set,
		update: baseStore.update,
		fetchAccount,
		saveAccount,
	} satisfies AccountSettingsStoreWritable;
}

export const accountSettings = createAccountSettingsStore();
export { type AccountSettingsStoreWritable };
