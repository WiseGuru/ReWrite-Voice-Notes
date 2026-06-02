import { LLMConfig, LLMProviderID } from '../types';
import { ProviderError } from '../http';
import { createAnthropicLLM } from './anthropic';
import { createOpenAILLM } from './openai';
import { createGeminiLLM } from './gemini';

// Anthropic and OpenAI reject (HTTP 400) a request whose output cap exceeds the
// model's max output tokens, with a body naming `max_tokens` /
// `max_completion_tokens` and a "maximum / too large / at most" phrase. The raw
// message is cryptic, so detect that specific case and rethrow with an actionable
// pointer to the "Maximum note length" setting. Everything else passes through
// unchanged. Used as a `.catch()` handler, so its `never` return keeps the awaited
// value's type intact. (Gemini silently clamps maxOutputTokens instead of erroring,
// so it needs no remap.)
export function remapOutputLimitError(e: unknown): never {
	if (
		e instanceof ProviderError &&
		e.status === 400 &&
		/max_tokens|max_completion_tokens/i.test(e.body) &&
		/maximum|at most|too large|exceed|output token/i.test(e.body)
	) {
		throw new ProviderError(
			e.provider,
			e.status,
			e.body,
			`${e.provider}: the requested note length exceeds this model's output limit. ` +
				'Lower "Maximum note length" in settings, or choose a model with a higher output cap.',
		);
	}
	throw e;
}

export interface LLMProvider {
	readonly id: LLMProviderID;
	complete(
		systemPrompt: string,
		userMessage: string,
		config: LLMConfig,
		signal?: AbortSignal,
	): Promise<string>;
	listModels?(config: LLMConfig, signal?: AbortSignal): Promise<string[]>;
}

export function createLLMProvider(id: LLMProviderID): LLMProvider {
	switch (id) {
		case 'none':
			return {
				id: 'none',
				complete: async (_systemPrompt, userMessage) => userMessage,
			};
		case 'anthropic':
			return createAnthropicLLM();
		case 'openai':
		case 'openai-compatible':
		case 'mistral':
			return createOpenAILLM(id);
		case 'gemini':
			return createGeminiLLM();
	}
}
