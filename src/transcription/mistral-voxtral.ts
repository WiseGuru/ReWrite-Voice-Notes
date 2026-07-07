import { TranscriptionConfig } from '../types';
import { jsonGet, MultipartPart, multipartPost, ProviderError } from '../http';
import { transcodeToWavPcm } from '../audio-transcode';
import { TranscriptionProvider } from './index';

// Mistral Voxtral diverges from the OpenAI Whisper shape on two points, so it
// gets its own adapter rather than dispatching through openai.ts:
//   1. Response is JSON only ({ text, segments, ... }); no response_format=text.
//   2. WebM/Opus is not an accepted input format, so the recorded blob is always
//      transcoded to 16 kHz mono WAV before upload (same path as whisper-local).
//      30 min of 16 kHz mono 16-bit PCM is ~57 MB, well under the 1 GB cap.
// listModels fetches the Mistral catalog and filters by ID substring `voxtral`.
const VOXTRAL_ENDPOINT = 'https://api.mistral.ai/v1/audio/transcriptions';
const MISTRAL_MODELS_ENDPOINT = 'https://api.mistral.ai/v1/models';

interface VoxtralResponse {
	text?: unknown;
}

interface MistralModelsResponse {
	data?: Array<{ id?: unknown }>;
}

export function createMistralVoxtralTranscription(): TranscriptionProvider {
	const provider: TranscriptionProvider = {
		id: 'mistral-voxtral',
		requiresAudio: true,
		async transcribe(
			audio: Blob,
			config: TranscriptionConfig,
			signal?: AbortSignal,
		): Promise<string> {
			if (!config.apiKey) throw new Error('mistral-voxtral: API key is not configured');
			if (!config.model) throw new Error('mistral-voxtral: model is not configured');
			let wavBuffer: ArrayBuffer;
			try {
				wavBuffer = await transcodeToWavPcm(audio, undefined, signal);
			} catch (e) {
				if (e instanceof DOMException && e.name === 'AbortError') throw e;
				const msg = e instanceof Error ? e.message : String(e);
				throw new ProviderError('mistral-voxtral', 0, '', `Failed to transcode audio to WAV for Voxtral: ${msg}`);
			}
			const parts: MultipartPart[] = [
				{
					type: 'file',
					name: 'file',
					filename: 'audio.wav',
					contentType: 'audio/wav',
					data: wavBuffer,
				},
				{ type: 'text', name: 'model', value: config.model },
			];
			if (config.language) {
				parts.push({ type: 'text', name: 'language', value: config.language });
			}
			const res = await multipartPost(
				'mistral-voxtral',
				VOXTRAL_ENDPOINT,
				parts,
				{ Authorization: `Bearer ${config.apiKey}` },
				signal,
			);
			const body = res.json as VoxtralResponse;
			const text = typeof body.text === 'string' ? body.text : '';
			if (!text) {
				throw new ProviderError('mistral-voxtral', res.status, res.text, 'Voxtral returned no text.');
			}
			return text.trim();
		},
	};

	provider.listModels = async (config, signal) => {
		if (!config.apiKey) throw new Error('mistral-voxtral: API key is not configured');
		const response = await jsonGet<MistralModelsResponse>(
			'mistral-voxtral',
			MISTRAL_MODELS_ENDPOINT,
			{ Authorization: `Bearer ${config.apiKey}` },
			signal,
		);
		return filterVoxtralModels(response.data ?? []);
	};

	return provider;
}

function filterVoxtralModels(rows: Array<{ id?: unknown }>): string[] {
	// Match Voxtral by name first, but also fall back to capability hints so we
	// pick up audio-capable models if Mistral ever renames the family or adds
	// new variants. Exclude obvious non-audio (chat/embed/moderation/etc).
	const out: string[] = [];
	for (const row of rows) {
		const id = typeof row.id === 'string' ? row.id : '';
		if (!id) continue;
		const lower = id.toLowerCase();
		if (
			lower.includes('voxtral')
			|| lower.includes('audio')
			|| lower.includes('transcribe')
		) {
			out.push(id);
		}
	}
	out.sort();
	return out;
}
