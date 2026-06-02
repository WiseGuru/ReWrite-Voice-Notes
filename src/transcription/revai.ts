import { TranscriptionConfig } from '../types';
import { jsonGet, MultipartPart, multipartPost, providerRequest, sleep } from '../http';
import { audioFilename, TranscriptionProvider } from './index';
import { pollTimeoutMs } from './limits';

const INITIAL_DELAY_MS = 1000;
const MAX_DELAY_MS = 8000;

interface JobCreateResponse {
	id?: string;
}

interface JobStatusResponse {
	status?: 'in_progress' | 'transcribed' | 'failed';
	failure_detail?: string;
	failure?: string;
}

interface RevAiTranscriptElement {
	value?: string;
}

interface RevAiMonologue {
	speaker?: number;
	elements?: RevAiTranscriptElement[];
}

interface RevAiTranscriptJson {
	monologues?: RevAiMonologue[];
}

export function createRevAITranscription(): TranscriptionProvider {
	return {
		id: 'revai',
		requiresAudio: true,
		async transcribe(
			audio: Blob,
			config: TranscriptionConfig,
			signal?: AbortSignal,
			durationMs?: number,
		): Promise<string> {
			if (!config.apiKey) throw new Error('revai: API key is not configured');
			const authHeaders = { Authorization: `Bearer ${config.apiKey}` };

			const data = await audio.arrayBuffer();
			const parts: MultipartPart[] = [
				{
					type: 'file',
					name: 'media',
					filename: audioFilename(audio),
					contentType: audio.type || 'application/octet-stream',
					data,
				},
			];
			const options: Record<string, unknown> = {};
			if (config.language) options.language = config.language;
			if (config.model) options.transcriber = config.model;
			if (Object.keys(options).length > 0) {
				parts.push({ type: 'text', name: 'options', value: JSON.stringify(options) });
			}
			const submit = await multipartPost(
				'revai',
				'https://api.rev.ai/speechtotext/v1/jobs',
				parts,
				authHeaders,
				signal,
			);
			const created = submit.json as JobCreateResponse;
			if (!created.id) {
				throw new Error('revai: submit response missing id');
			}

			await pollRevAI(created.id, authHeaders, pollTimeoutMs(durationMs), signal);

			// Rev.ai diarizes by default. The plain-text transcript flattens that
			// away, so when diarization is requested we fetch the JSON transcript
			// and rebuild speaker-labeled text from its monologues.
			if (config.diarize) {
				const json = await providerRequest({
					provider: 'revai',
					url: `https://api.rev.ai/speechtotext/v1/jobs/${created.id}/transcript`,
					method: 'GET',
					headers: { ...authHeaders, Accept: 'application/vnd.rev.transcript.v1.0+json' },
					signal,
				});
				const labeled = formatMonologues(json.json as RevAiTranscriptJson);
				if (labeled) return labeled;
			}

			const transcript = await providerRequest({
				provider: 'revai',
				url: `https://api.rev.ai/speechtotext/v1/jobs/${created.id}/transcript`,
				method: 'GET',
				headers: { ...authHeaders, Accept: 'text/plain' },
				signal,
			});
			return transcript.text.trim();
		},
	};
}

// Rebuilds speaker-labeled text from Rev.ai's JSON transcript. Each monologue's
// elements (text and punctuation) concatenate back into the spoken text; the
// 0-based speaker index is bumped to 1-based so labels never read "Speaker 0".
function formatMonologues(json: RevAiTranscriptJson): string {
	const monologues = json.monologues ?? [];
	return monologues
		.map((m) => {
			const text = (m.elements ?? []).map((e) => e.value ?? '').join('').trim();
			return `Speaker ${(m.speaker ?? 0) + 1}: ${text}`;
		})
		.join('\n\n')
		.trim();
}

async function pollRevAI(
	id: string,
	headers: Record<string, string>,
	timeoutMs: number,
	signal: AbortSignal | undefined,
): Promise<void> {
	const start = Date.now();
	let delay = INITIAL_DELAY_MS;
	for (;;) {
		const elapsed = Date.now() - start;
		if (elapsed > timeoutMs) {
			throw new Error(`revai: poll timeout after ${Math.round(timeoutMs / 1000)}s`);
		}
		const status = await jsonGet<JobStatusResponse>(
			'revai',
			`https://api.rev.ai/speechtotext/v1/jobs/${id}`,
			headers,
			signal,
		);
		if (status.status === 'transcribed') return;
		if (status.status === 'failed') {
			throw new Error(`revai: ${status.failure_detail ?? status.failure ?? 'transcription failed'}`);
		}
		await sleep(delay, signal);
		delay = Math.min(delay * 2, MAX_DELAY_MS);
	}
}
