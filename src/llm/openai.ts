import { LLMConfig, LLMProviderID } from '../types';
import { jsonGet, jsonPost } from '../http';
import { LLMProvider, remapOutputLimitError } from './index';

interface ChatCompletionResponse {
	choices?: Array<{
		message?: { content?: string };
	}>;
}

interface ModelsListResponse {
	data?: Array<{ id?: unknown }>;
}

// OpenAI's reasoning models (o1/o3/o4 families, gpt-5 family) reject the legacy
// `max_tokens` param and require `max_completion_tokens`. Scoped to id === 'openai'
// because only the first-party endpoint enforces this; openai-compatible servers
// and Mistral keep `max_tokens`. A proxied reasoning model behind openai-compatible
// is the known gap (documented in CLAUDE.md).
function usesCompletionTokens(id: LLMProviderID, model: string): boolean {
	return id === 'openai' && /^(o\d|gpt-5)/i.test(model.trim());
}

export function createOpenAILLM(id: LLMProviderID): LLMProvider {
	const provider: LLMProvider = {
		id,
		async complete(
			systemPrompt: string,
			userMessage: string,
			config: LLMConfig,
			signal?: AbortSignal,
		): Promise<string> {
			if (!config.apiKey) throw new Error(`${id}: API key is not configured`);
			if (!config.model) throw new Error(`${id}: model is not configured`);
			const url = resolveEndpoint(id, config);
			const body: Record<string, unknown> = {
				model: config.model,
				messages: [
					{ role: 'system', content: systemPrompt },
					{ role: 'user', content: userMessage },
				],
			};
			if (config.maxTokens > 0) {
				if (usesCompletionTokens(id, config.model)) {
					body.max_completion_tokens = config.maxTokens;
				} else {
					body.max_tokens = config.maxTokens;
				}
			}
			const response = await jsonPost<ChatCompletionResponse>(
				id,
				url,
				body,
				{ Authorization: `Bearer ${config.apiKey}` },
				signal,
			).catch(remapOutputLimitError);
			const content = response.choices?.[0]?.message?.content;
			if (typeof content !== 'string') {
				throw new Error(`${id}: response missing message content`);
			}
			return content.trim();
		},
	};

	if (id !== 'openai-compatible') {
		provider.listModels = async (config, signal) => {
			if (!config.apiKey) throw new Error(`${id}: API key is not configured`);
			const url = id === 'mistral'
				? 'https://api.mistral.ai/v1/models'
				: 'https://api.openai.com/v1/models';
			const response = await jsonGet<ModelsListResponse>(
				id,
				url,
				{ Authorization: `Bearer ${config.apiKey}` },
				signal,
			);
			return filterChatModels(response.data ?? []);
		};
	}

	return provider;
}

function filterChatModels(rows: Array<{ id?: unknown }>): string[] {
	const out: string[] = [];
	for (const row of rows) {
		const id = typeof row.id === 'string' ? row.id : '';
		if (!id) continue;
		const lower = id.toLowerCase();
		if (lower.includes('whisper') || lower.includes('embedding')) continue;
		if (lower.includes('transcribe') || lower.includes('tts')) continue;
		if (lower.includes('dall-e') || lower.includes('image')) continue;
		if (lower.includes('audio') || lower.includes('speech')) continue;
		if (lower.includes('moderation') || lower.includes('search')) continue;
		out.push(id);
	}
	out.sort();
	return out;
}

function resolveEndpoint(id: LLMProviderID, config: LLMConfig): string {
	switch (id) {
		case 'openai':
			return 'https://api.openai.com/v1/chat/completions';
		case 'mistral':
			return 'https://api.mistral.ai/v1/chat/completions';
		case 'openai-compatible': {
			const base = config.baseUrl.trim().replace(/\/+$/, '');
			if (!base) {
				throw new Error('openai-compatible: base URL is not configured');
			}
			return `${base}/chat/completions`;
		}
		default:
			throw new Error(`Unsupported LLM provider id in OpenAI adapter: ${String(id)}`);
	}
}
