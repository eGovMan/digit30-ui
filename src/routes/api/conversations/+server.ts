import { json } from "@sveltejs/kit";
import { collections } from "$lib/server/database";
import { models } from "$lib/server/models";
import { authCondition } from "$lib/server/auth";
import type { Conversation } from "$lib/types/Conversation";
import { ObjectId } from "mongodb";
import { CONV_NUM_PER_PAGE } from "$lib/constants/pagination";

export async function GET({ locals, url }) {
	const p = parseInt(url.searchParams.get("p") ?? "0");

	if (locals.user?._id || locals.sessionId) {
		const convs = await collections.conversations
			.find({
				...authCondition(locals),
			})
			.project<Pick<Conversation, "_id" | "title" | "updatedAt" | "model" | "assistantId">>({
				title: 1,
				updatedAt: 1,
				model: 1,
				assistantId: 1,
			})
			.sort({ updatedAt: -1 })
			.skip(p * CONV_NUM_PER_PAGE)
			.limit(CONV_NUM_PER_PAGE)
			.toArray();

		if (convs.length === 0) {
			return json([]);
		}

		const res = convs.map((conv) => ({
			_id: conv._id,
			id: conv._id,
			title: conv.title,
			updatedAt: conv.updatedAt,
			model: conv.model,
			modelId: conv.model,
			assistantId: conv.assistantId,
			modelTools: models.find((m) => m.id == conv.model)?.tools ?? false,
		}));
		return json(res);
	} else {
		return json({ message: "Must have session cookie" }, { status: 401 });
	}
}

export async function POST({ request, locals }) {
	const { message } = await request.json();
	const sessionId = locals.sessionId || crypto.randomUUID();

	const llmUrl = "http://llama-server:8082";
	const response = await fetch(`${llmUrl}/v1/chat/completions`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			messages: [{ role: "user", content: message }],
			model: "Qwen/Qwen2-7B-Instruct-GGUF",
		}),
	});

	if (!response.ok) {
		return json({ error: "Failed to get LLM response" }, { status: 500 });
	}

	const llmResponse = await response.json();
	const assistantMessage = llmResponse.choices[0].message.content;

	const conv = {
		_id: new ObjectId(),
		sessionId,
		title: message.substring(0, 50), // Add a title based on the message
		messages: [
			{ id: crypto.randomUUID(), from: "user", content: message, createdAt: new Date() },
			{
				id: crypto.randomUUID(),
				from: "assistant",
				content: assistantMessage,
				createdAt: new Date(),
			},
		],
		updatedAt: new Date(),
		model: "Qwen/Qwen2-7B-Instruct-GGUF",
	};
	await collections.conversations.insertOne(conv);

	return json({ message: assistantMessage });
}

export async function DELETE({ locals }) {
	if (locals.user?._id || locals.sessionId) {
		await collections.conversations.deleteMany({
			...authCondition(locals),
		});
	}
	return new Response();
}
