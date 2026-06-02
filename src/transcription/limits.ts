import { TranscriptionProviderID } from '../types';

// Per-provider audio upload limits. Sources:
// - OpenAI Whisper: 25 MB (platform.openai.com/docs/guides/speech-to-text)
// - Groq: 25 MB on free tier; higher on paid tiers but the UI can't tell, so use the conservative number (console.groq.com/docs/speech-to-text)
// - AssemblyAI: 5 GB / 10 h (assemblyai.com/docs/faq)
// - Deepgram: 2 GB sync (developers.deepgram.com)
// - Rev.ai: 2 GB multipart / 17 h (docs.rev.ai/api/asynchronous)
// - Mistral Voxtral: 1 GB / 30 min (docs.mistral.ai/api/endpoint/audio/transcriptions)
// - openai-compatible / whisper-local: no client-side cap
export interface TranscriptionLimits {
	readonly maxBytes?: number;
	readonly maxDurationMs?: number;
}

const MB = 1024 * 1024;
const GB = 1024 * MB;
const MIN = 60 * 1000;
const HOUR = 60 * MIN;

export function getTranscriptionLimits(id: TranscriptionProviderID): TranscriptionLimits {
	switch (id) {
		case 'none':
			return {};
		case 'openai':
			return { maxBytes: 25 * MB };
		case 'groq':
			return { maxBytes: 25 * MB };
		case 'assemblyai':
			return { maxBytes: 5 * GB, maxDurationMs: 10 * HOUR };
		case 'deepgram':
			return { maxBytes: 2 * GB };
		case 'revai':
			return { maxBytes: 2 * GB, maxDurationMs: 17 * HOUR };
		case 'mistral-voxtral':
			return { maxBytes: 1 * GB, maxDurationMs: 30 * MIN };
		case 'openai-compatible':
		case 'whisper-local':
			return {};
	}
}

export function transcriptionProviderLabel(id: TranscriptionProviderID): string {
	switch (id) {
		case 'none': return 'None';
		case 'openai': return 'OpenAI Whisper';
		case 'groq': return 'Groq';
		case 'assemblyai': return 'AssemblyAI';
		case 'deepgram': return 'Deepgram';
		case 'revai': return 'Rev.ai';
		case 'mistral-voxtral': return 'Mistral Voxtral';
		case 'openai-compatible': return 'OpenAI-compatible';
		case 'whisper-local': return 'Local whisper.cpp';
	}
}

// Poll budget for async transcription providers (AssemblyAI, Rev.ai). A fixed
// short timeout makes long recordings fail before the server finishes; a fixed
// long one makes a stuck short clip hang for minutes. Scale with the audio
// duration instead: ~2x real-time over a 1 min base, clamped so a short clip
// with a problem fails fast and the longest advertised jobs still have room.
// Unknown duration (reprocess of an arbitrary vault file, where we don't measure
// length) falls back to the ceiling.
const POLL_FLOOR_MS = 60 * 1000; // 1 min: short clips + network slop
const POLL_CEILING_MS = 2 * HOUR; // covers the longest realistic provider jobs

export function pollTimeoutMs(durationMs?: number): number {
	if (!durationMs || durationMs <= 0) return POLL_CEILING_MS;
	return Math.min(POLL_FLOOR_MS + durationMs * 2, POLL_CEILING_MS);
}

export function validateRecording(
	blobSize: number,
	durationMs: number | undefined,
	id: TranscriptionProviderID,
): void {
	const limits = getTranscriptionLimits(id);
	const label = transcriptionProviderLabel(id);
	if (limits.maxBytes !== undefined && blobSize > limits.maxBytes) {
		const sizeMb = Math.round(blobSize / MB);
		const limitMb = Math.round(limits.maxBytes / MB);
		throw new Error(
			`Recording is ${sizeMb} MB which exceeds the ${label} ${limitMb} MB limit. Save the audio elsewhere or switch transcription provider in settings.`,
		);
	}
	if (
		limits.maxDurationMs !== undefined &&
		durationMs !== undefined &&
		durationMs > limits.maxDurationMs
	) {
		const mins = Math.round(durationMs / MIN);
		const limitMins = Math.round(limits.maxDurationMs / MIN);
		throw new Error(
			`Recording is ${mins} min which exceeds the ${label} ${limitMins} min limit. Switch transcription provider in settings.`,
		);
	}
}
