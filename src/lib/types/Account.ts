export interface OIDCSettings {
	scopes: string;
	authUrl: string;
	clientId: string;
	resource: string;
	nameClaim: string;
	tolerance: string;
	redirectUri: string;
}

export interface ModelEndpoint {
	type: string;
	baseURL?: string;
}

export interface PromptExample {
	title: string;
	prompt: string;
}

export interface ModelConfig {
	name: string;
	description?: string;
	endpoints: ModelEndpoint[];
	promptExamples: PromptExample[];
}

export interface TextEmbeddingModelEndpoint {
	type: string;
}

export interface TextEmbeddingModelConfig {
	name: string;
	description?: string;
	displayName: string;
	chunkCharLength: number;
	endpoints: TextEmbeddingModelEndpoint[];
}

export interface AccountSettingsStore {
	loading: boolean;
	saving: boolean;
	error: string | null;
	saveError: string | null;
	accountname: string;
	adminEmail: string | null;
	adminPhone: string | null;
	oidc: OIDCSettings;
	models: ModelConfig[];
	textEmbeddingModels: TextEmbeddingModelConfig[];
}
