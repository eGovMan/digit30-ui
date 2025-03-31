// src/routes/+layout.server.ts
import type { LayoutServerLoad } from "./$types";
import { collections } from "$lib/server/database";
import type { Conversation } from "$lib/types/Conversation";
import { UrlDependency } from "$lib/types/UrlDependency";
import { defaultModel, oldModels } from "$lib/server/models"; // Remove static `models`
import { authCondition, requiresUser } from "$lib/server/auth";
import { DEFAULT_SETTINGS } from "$lib/types/Settings";
import { env } from "$env/dynamic/private";
import { ObjectId } from "mongodb";
import type { ConvSidebar } from "$lib/types/ConvSidebar";
import { toolFromConfigs } from "$lib/server/tools";
import { MetricsServer } from "$lib/server/metrics";
import type { ToolInputFile } from "$lib/types/Tool";
import { ReviewStatus } from "$lib/types/Review";
import { base } from "$app/paths";

export const load: LayoutServerLoad = async ({ locals, depends, fetch }) => {
	depends(UrlDependency.ConversationList);

	// Fetch dynamic config from account-service
	const kongProxyUrl = env.KONG_PROXY_URL || "http://localhost:8000";
	const response = await fetch(`${kongProxyUrl}/account-service/client/eGov`);
	const config = response.ok ? await response.json() : {};
	const models = config.models || []; // Dynamic models from account-service

	const settings = await collections.settings.findOne(authCondition(locals));

	// If active model isn’t valid, set to first model from account-service or default
	if (
		settings &&
		!models.some((m: { id: string }) => m.id === settings.activeModel) &&
		!settings.assistants?.map((el) => el.toString())?.includes(settings?.activeModel)
	) {
		const newActiveModel = models[0]?.id || defaultModel.id;
		settings.activeModel = newActiveModel;
		await collections.settings.updateOne(authCondition(locals), {
			$set: { activeModel: newActiveModel },
		});
	}

	// If the model is unlisted, reset to first available
	if (
		settings?.activeModel &&
		models.find((m: { id: string; unlisted?: boolean }) => m.id === settings.activeModel)?.unlisted
	) {
		const newActiveModel = models[0]?.id || defaultModel.id;
		settings.activeModel = newActiveModel;
		await collections.settings.updateOne(authCondition(locals), {
			$set: { activeModel: newActiveModel },
		});
	}

	const enableAssistants = env.ENABLE_ASSISTANTS === "true";
	const assistantActive = !models.some((m: { id: string }) => m.id === settings?.activeModel);

	// console.log("settings.activeModel:", settings?.activeModel);
	const assistant =
		assistantActive && settings?.activeModel && /^[0-9a-fA-F]{24}$/.test(settings.activeModel)
			? await collections.assistants.findOne({
					_id: new ObjectId(settings?.activeModel),
				})
			: null;

	const nConversations = await collections.conversations.countDocuments(authCondition(locals));

	const conversations =
		nConversations === 0
			? Promise.resolve([])
			: fetch(`${base}/api/conversations`)
					.then((res) => res.json())
					.then(
						(
							convs: Pick<Conversation, "_id" | "title" | "updatedAt" | "model" | "assistantId">[]
						) =>
							convs.map((conv) => ({
								...conv,
								updatedAt: new Date(conv.updatedAt),
							}))
					);

	const userAssistants = settings?.assistants?.map((assistantId) => assistantId.toString()) ?? [];
	const userAssistantsSet = new Set(userAssistants);

	const assistants = conversations.then((conversations) =>
		collections.assistants
			.find({
				_id: {
					$in: [
						...userAssistants.map((el) => new ObjectId(el)),
						...(conversations.map((conv) => conv.assistantId).filter((el) => !!el) as ObjectId[]),
					],
				},
			})
			.toArray()
	);

	const messagesBeforeLogin = env.MESSAGES_BEFORE_LOGIN ? parseInt(env.MESSAGES_BEFORE_LOGIN) : 0;

	const loginRequired = false;

	// `if (requiresUser && !locals.user) {
	//     if (messagesBeforeLogin === 0) {
	//         loginRequired = true;
	//     } else if (nConversations >= messagesBeforeLogin) {
	//         loginRequired = true;
	//     } else {
	//         const totalMessages =
	//             (
	//                 await collections.conversations
	//                     .aggregate([
	//                         { $match: { ...authCondition(locals), "messages.from": "assistant" } },
	//                         { $project: { messages: 1 } },
	//                         { $limit: messagesBeforeLogin + 1 },
	//                         { $unwind: "$messages" },
	//                         { $match: { "messages.from": "assistant" } },
	//                         { $count: "messages" },
	//                     ])
	//                     .toArray()
	//             )[0]?.messages ?? 0;

	//         loginRequired = totalMessages >= messagesBeforeLogin;
	//     }
	// }`

	const toolUseDuration = (await MetricsServer.getMetrics().tool.toolUseDuration.get()).values;

	const configToolIds = toolFromConfigs.map((el) => el._id.toString());

	let activeCommunityToolIds = (settings?.tools ?? []).filter(
		(key) => !configToolIds.includes(key)
	);

	if (assistant) {
		activeCommunityToolIds = [...activeCommunityToolIds, ...(assistant.tools ?? [])];
	}

	const communityTools = await collections.tools
		.find({ _id: { $in: activeCommunityToolIds.map((el) => new ObjectId(el)) } })
		.toArray()
		.then((tools) =>
			tools.map((tool) => ({
				...tool,
				isHidden: false,
				isOnByDefault: true,
				isLocked: true,
			}))
		);

	return {
		nConversations,
		conversations: await conversations.then(
			async (convs) =>
				await Promise.all(
					convs.map(async (conv) => {
						if (settings?.hideEmojiOnSidebar) {
							conv.title = conv.title.replace(/\p{Emoji}/gu, "");
						}
						conv.title = conv.title.replace(/\uFFFD/gu, "").trimStart();

						let avatarUrl: string | undefined = undefined;

						if (conv.assistantId) {
							const hash = (
								await collections.assistants.findOne({
									_id: new ObjectId(conv.assistantId),
								})
							)?.avatar;
							if (hash) {
								avatarUrl = `/settings/assistants/${conv.assistantId}/avatar.jpg?hash=${hash}`;
							}
						}

						return {
							id: conv._id.toString(),
							title: conv.title,
							model: conv.model ?? defaultModel,
							updatedAt: conv.updatedAt,
							assistantId: conv.assistantId?.toString(),
							avatarUrl,
						} satisfies ConvSidebar;
					})
				)
		),
		settings: {
			searchEnabled: !!(
				env.SERPAPI_KEY ||
				env.SERPER_API_KEY ||
				env.SERPSTACK_API_KEY ||
				env.SEARCHAPI_KEY ||
				env.YDC_API_KEY ||
				env.USE_LOCAL_WEBSEARCH ||
				env.SEARXNG_QUERY_URL ||
				env.BING_SUBSCRIPTION_KEY
			),
			ethicsModalAccepted: !!settings?.ethicsModalAcceptedAt,
			ethicsModalAcceptedAt: settings?.ethicsModalAcceptedAt ?? null,
			activeModel: settings?.activeModel ?? (models[0]?.id || DEFAULT_SETTINGS.activeModel),
			hideEmojiOnSidebar: settings?.hideEmojiOnSidebar ?? false,
			shareConversationsWithModelAuthors:
				settings?.shareConversationsWithModelAuthors ??
				DEFAULT_SETTINGS.shareConversationsWithModelAuthors,
			customPrompts: settings?.customPrompts ?? {},
			assistants: userAssistants,
			tools:
				settings?.tools ??
				toolFromConfigs
					.filter((el) => !el.isHidden && el.isOnByDefault)
					.map((el) => el._id.toString()),
			disableStream: settings?.disableStream ?? DEFAULT_SETTINGS.disableStream,
			directPaste: settings?.directPaste ?? DEFAULT_SETTINGS.directPaste,
		},
		models: models.map((model) => ({
			id: model.name, // Use "name" as id to match account-service
			name: model.name,
			websiteUrl: model.websiteUrl,
			modelUrl: model.modelUrl,
			tokenizer: model.tokenizer,
			datasetName: model.datasetName,
			datasetUrl: model.datasetUrl,
			displayName: model.displayName || model.name,
			description: model.description,
			reasoning: !!model.reasoning,
			logoUrl: model.logoUrl,
			promptExamples: model.promptExamples,
			parameters: model.parameters,
			preprompt: model.preprompt,
			multimodal: model.multimodal || false,
			multimodalAcceptedMimetypes: model.multimodalAcceptedMimetypes,
			tools: model.tools || false,
			unlisted: model.unlisted || false,
			hasInferenceAPI: model.hasInferenceAPI || false,
		})),
		oldModels,
		tools: [...toolFromConfigs, ...communityTools]
			.filter((tool) => !tool?.isHidden)
			.map((tool) => ({
				_id: tool._id.toString(),
				type: tool.type,
				displayName: tool.displayName,
				name: tool.name,
				description: tool.description,
				mimeTypes: (tool.inputs ?? [])
					.filter((input): input is ToolInputFile => input.type === "file")
					.map((input) => (input as ToolInputFile).mimeTypes)
					.flat(),
				isOnByDefault: tool.isOnByDefault ?? true,
				isLocked: tool.isLocked ?? true,
				timeToUseMS:
					toolUseDuration.find(
						(el) => el.labels.tool === tool._id.toString() && el.labels.quantile === 0.9
					)?.value ?? 15_000,
				color: tool.color,
				icon: tool.icon,
			})),
		communityToolCount: await collections.tools.countDocuments({
			type: "community",
			review: ReviewStatus.APPROVED,
		}),
		assistants: assistants.then((assistants) =>
			assistants
				.filter((el) => userAssistantsSet.has(el._id.toString()))
				.map((el) => ({
					...el,
					_id: el._id.toString(),
					createdById: undefined,
					createdByMe:
						el.createdById.toString() === (locals.user?._id ?? locals.sessionId).toString(),
				}))
		),
		user: locals.user && {
			id: locals.user._id.toString(),
			username: locals.user.username,
			avatarUrl: locals.user.avatarUrl,
			email: locals.user.email,
			logoutDisabled: locals.user.logoutDisabled,
			isAdmin: locals.user.isAdmin ?? false,
			isEarlyAccess: locals.user.isEarlyAccess ?? false,
		},
		assistant: assistant ? JSON.parse(JSON.stringify(assistant)) : null,
		enableAssistants,
		enableAssistantsRAG: env.ENABLE_ASSISTANTS_RAG === "true",
		enableCommunityTools: env.COMMUNITY_TOOLS === "true",
		loginRequired,
		loginEnabled: requiresUser,
		guestMode: requiresUser && messagesBeforeLogin > 0,
	};
};
