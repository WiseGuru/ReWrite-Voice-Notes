import { TranscriptionConfig } from '../types';
import { jsonGet, jsonPost, ProviderError, providerRequest, sleep } from '../http';
import { TranscriptionProvider } from './index';
import { pollTimeoutMs } from './limits';

const INITIAL_DELAY_MS = 1000;
const MAX_DELAY_MS = 8000;
// A single transient poll failure (network blip, 5xx) must not fail a long-running
// job that would otherwise have completed on the server. Tolerate this many
// consecutive transient failures before giving up; a 4xx or AbortError still
// rethrows immediately since retrying cannot fix those.
const MAX_CONSECUTIVE_POLL_ERRORS = 3;

function isTransientPollError(e: unknown): boolean {
	if (e instanceof DOMException && e.name === 'AbortError') return false;
	if (e instanceof ProviderError) return e.status === 0 || e.status >= 500;
	return true;
}

interface UploadResponse {
	upload_url?: string;
}

interface TranscriptCreateResponse {
	id?: string;
}

interface Utterance {
	speaker?: string;
	text?: string;
}

interface TranscriptStatusResponse {
	status?: 'queued' | 'processing' | 'completed' | 'error';
	text?: string;
	utterances?: Utterance[];
	error?: string;
}

export function createAssemblyAITranscription(): TranscriptionProvider {
	return {
		id: 'assemblyai',
		requiresAudio: true,
		async transcribe(
			audio: Blob,
			config: TranscriptionConfig,
			signal?: AbortSignal,
			durationMs?: number,
		): Promise<string> {
			if (!config.apiKey) throw new Error('assemblyai: API key is not configured');
			const authHeaders = { Authorization: config.apiKey };

			const uploadBody = await audio.arrayBuffer();
			const uploadRes = await providerRequest({
				provider: 'assemblyai',
				url: 'https://api.assemblyai.com/v2/upload',
				method: 'POST',
				headers: { ...authHeaders, 'Content-Type': 'application/octet-stream' },
				body: uploadBody,
				signal,
			});
			const uploadUrl = (uploadRes.json as UploadResponse).upload_url;
			if (!uploadUrl) {
				throw new Error('assemblyai: upload response missing upload_url');
			}

			const createBody: Record<string, unknown> = { audio_url: uploadUrl };
			if (config.model) createBody.speech_models = [config.model];
			if (config.language) createBody.language_code = config.language;
			if (config.diarize) createBody.speaker_labels = true;
			const created = await jsonPost<TranscriptCreateResponse>(
				'assemblyai',
				'https://api.assemblyai.com/v2/transcript',
				createBody,
				authHeaders,
				signal,
			);
			if (!created.id) {
				throw new Error('assemblyai: transcript request missing id');
			}

			return pollAssemblyAI(created.id, authHeaders, !!config.diarize, pollTimeoutMs(durationMs), signal);
		},
	};
}

function formatUtterances(utterances: Utterance[]): string {
	return utterances
		.map((u) => `Speaker ${u.speaker ?? '?'}: ${(u.text ?? '').trim()}`)
		.join('\n\n')
		.trim();
}

async function pollAssemblyAI(
	id: string,
	headers: Record<string, string>,
	diarize: boolean,
	timeoutMs: number,
	signal: AbortSignal | undefined,
): Promise<string> {
	const start = Date.now();
	let delay = INITIAL_DELAY_MS;
	let consecutiveErrors = 0;
	for (;;) {
		const elapsed = Date.now() - start;
		if (elapsed > timeoutMs) {
			throw new Error(`assemblyai: poll timeout after ${Math.round(timeoutMs / 1000)}s`);
		}
		let status: TranscriptStatusResponse;
		try {
			status = await jsonGet<TranscriptStatusResponse>(
				'assemblyai',
				`https://api.assemblyai.com/v2/transcript/${id}`,
				headers,
				signal,
			);
			consecutiveErrors = 0;
		} catch (e) {
			consecutiveErrors++;
			if (!isTransientPollError(e) || consecutiveErrors >= MAX_CONSECUTIVE_POLL_ERRORS) throw e;
			await sleep(delay, signal);
			delay = Math.min(delay * 2, MAX_DELAY_MS);
			continue;
		}
		if (status.status === 'completed') {
			if (diarize && Array.isArray(status.utterances) && status.utterances.length > 0) {
				return formatUtterances(status.utterances);
			}
			if (typeof status.text !== 'string') {
				throw new Error('assemblyai: completed response missing text');
			}
			return status.text.trim();
		}
		if (status.status === 'error') {
			throw new Error(`assemblyai: ${status.error ?? 'transcription failed'}`);
		}
		await sleep(delay, signal);
		delay = Math.min(delay * 2, MAX_DELAY_MS);
	}
}
