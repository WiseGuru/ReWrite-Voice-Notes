import { LLMConfig } from '../types';
import { jsonGet, jsonPost } from '../http';
import { LLMProvider, remapOutputLimitError } from './index';

interface MessagesResponse {
	content?: Array<{ type?: string; text?: string }>;
	stop_reason?: string;
}

interface ModelsListResponse {
	data?: Array<{ id?: unknown }>;
}

const ANTHROPIC_HEADERS = {
	'anthropic-version': '2023-06-01',
	'anthropic-dangerous-direct-browser-access': 'true',
};

export function createAnthropicLLM(): LLMProvider {
	return {
		id: 'anthropic',
		async complete(
			systemPrompt: string,
			userMessage: string,
			config: LLMConfig,
			signal?: AbortSignal,
		): Promise<string> {
			if (!config.apiKey) throw new Error('anthropic: API key is not configured');
			if (!config.model) throw new Error('anthropic: model is not configured');
			const body = {
				model: config.model,
				max_tokens: config.maxTokens > 0 ? config.maxTokens : 2560,
				system: systemPrompt,
				messages: [{ role: 'user', content: userMessage }],
			};
			const response = await jsonPost<MessagesResponse>(
				'anthropic',
				'https://api.anthropic.com/v1/messages',
				body,
				{
					'x-api-key': config.apiKey,
					...ANTHROPIC_HEADERS,
				},
				signal,
			).catch(remapOutputLimitError);
			const firstText = response.content?.find((block) => block.type === 'text' && typeof block.text === 'string');
			if (!firstText || typeof firstText.text !== 'string') {
				throw new Error(`anthropic: response missing text content (stop_reason=${response.stop_reason ?? 'unknown'})`);
			}
			return firstText.text.trim();
		},
		async listModels(config, signal) {
			if (!config.apiKey) throw new Error('anthropic: API key is not configured');
			const response = await jsonGet<ModelsListResponse>(
				'anthropic',
				'https://api.anthropic.com/v1/models?limit=1000',
				{
					'x-api-key': config.apiKey,
					...ANTHROPIC_HEADERS,
				},
				signal,
			);
			const out: string[] = [];
			for (const row of response.data ?? []) {
				if (typeof row.id === 'string' && row.id) out.push(row.id);
			}
			out.sort();
			return out;
		},
	};
}
