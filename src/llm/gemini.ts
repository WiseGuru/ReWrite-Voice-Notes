import { LLMConfig } from '../types';
import { jsonGet, jsonPost } from '../http';
import { LLMProvider } from './index';

interface GenerateContentResponse {
	candidates?: Array<{
		content?: { parts?: Array<{ text?: string }> };
		finishReason?: string;
	}>;
	promptFeedback?: { blockReason?: string };
}

interface GeminiModelsResponse {
	models?: Array<{
		name?: unknown;
		supportedGenerationMethods?: unknown;
	}>;
}

export function createGeminiLLM(): LLMProvider {
	return {
		id: 'gemini',
		async complete(
			systemPrompt: string,
			userMessage: string,
			config: LLMConfig,
			signal?: AbortSignal,
		): Promise<string> {
			if (!config.apiKey) throw new Error('gemini: API key is not configured');
			if (!config.model) throw new Error('gemini: model is not configured');
			const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent`;
			const body: Record<string, unknown> = {
				system_instruction: { parts: [{ text: systemPrompt }] },
				contents: [{ parts: [{ text: userMessage }] }],
			};
			if (config.maxTokens > 0) {
				body.generationConfig = { maxOutputTokens: config.maxTokens };
			}
			const response = await jsonPost<GenerateContentResponse>(
				'gemini',
				url,
				body,
				{ 'x-goog-api-key': config.apiKey },
				signal,
			);
			if (response.promptFeedback?.blockReason) {
				throw new Error(`gemini: blocked by safety filter (${response.promptFeedback.blockReason})`);
			}
			const candidate = response.candidates?.[0];
			if (candidate?.finishReason === 'SAFETY') {
				throw new Error('gemini: response blocked by safety filter');
			}
			if (candidate?.finishReason === 'RECITATION') {
				throw new Error('gemini: response blocked (matched a recitation/citation filter)');
			}
			if (candidate?.finishReason === 'PROHIBITED_CONTENT') {
				throw new Error('gemini: response blocked (prohibited content)');
			}
			if (candidate?.finishReason === 'MAX_TOKENS') {
				throw new Error(
					'gemini: the requested note length exceeds this model\'s output limit. '
					+ 'Lower "Maximum note length" in settings, or choose a model with a higher output cap.',
				);
			}
			// Gemini can split a response across multiple parts; concatenate all of them rather
			// than reading only parts[0], which would silently truncate long notes at the boundary.
			const parts = candidate?.content?.parts;
			if (!parts || parts.length === 0) {
				throw new Error(`gemini: response missing text (finishReason=${candidate?.finishReason ?? 'unknown'})`);
			}
			return parts.map((p) => p.text ?? '').join('').trim();
		},
		async listModels(config, signal) {
			if (!config.apiKey) throw new Error('gemini: API key is not configured');
			const url = `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000`;
			const response = await jsonGet<GeminiModelsResponse>('gemini', url, { 'x-goog-api-key': config.apiKey }, signal);
			const out: string[] = [];
			for (const row of response.models ?? []) {
				const methods = Array.isArray(row.supportedGenerationMethods)
					? row.supportedGenerationMethods.filter((m): m is string => typeof m === 'string')
					: [];
				if (!methods.includes('generateContent')) continue;
				const name = typeof row.name === 'string' ? row.name : '';
				if (!name) continue;
				const stripped = name.startsWith('models/') ? name.slice('models/'.length) : name;
				out.push(stripped);
			}
			out.sort();
			return out;
		},
	};
}
