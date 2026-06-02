import { TranscriptionConfig, TranscriptionProviderID } from '../types';
import { createOpenAITranscription } from './openai';
import { createAssemblyAITranscription } from './assemblyai';
import { createDeepgramTranscription } from './deepgram';
import { createRevAITranscription } from './revai';
import { createMistralVoxtralTranscription } from './mistral-voxtral';
import { createWhisperLocalTranscription } from './whisper-local';

export interface TranscriptionProvider {
	readonly id: TranscriptionProviderID;
	readonly requiresAudio: boolean;
	transcribe(
		audio: Blob,
		config: TranscriptionConfig,
		signal?: AbortSignal,
		// Recorded audio length, when known. Used only by the async polling
		// adapters (AssemblyAI, Rev.ai) to size their poll timeout; ignored by the
		// rest. Undefined for reprocess flows that don't measure the file.
		durationMs?: number,
	): Promise<string>;
	listModels?(config: TranscriptionConfig, signal?: AbortSignal): Promise<string[]>;
}

export function createTranscriptionProvider(
	id: TranscriptionProviderID,
): TranscriptionProvider {
	switch (id) {
		case 'none':
			return {
				id: 'none',
				requiresAudio: false,
				transcribe: async () => {
					throw new Error('Transcription is disabled (provider set to None). Use the Paste or From note tab instead.');
				},
			};
		case 'openai':
		case 'openai-compatible':
		case 'groq':
			return createOpenAITranscription(id);
		case 'assemblyai':
			return createAssemblyAITranscription();
		case 'deepgram':
			return createDeepgramTranscription();
		case 'revai':
			return createRevAITranscription();
		case 'mistral-voxtral':
			return createMistralVoxtralTranscription();
		case 'whisper-local':
			return createWhisperLocalTranscription();
	}
}

// Providers that can return speaker-attributed transcripts. The settings tab
// shows the "Identify speakers" toggle only for these; the rest ignore the
// `diarize` flag entirely.
export function transcriptionProviderSupportsDiarization(
	id: TranscriptionProviderID,
): boolean {
	return id === 'assemblyai' || id === 'deepgram' || id === 'revai';
}

export function audioFilename(audio: Blob): string {
	const type = (audio.type || '').toLowerCase();
	if (type.includes('mp4')) return 'audio.mp4';
	if (type.includes('m4a')) return 'audio.m4a';
	if (type.includes('webm')) return 'audio.webm';
	if (type.includes('ogg')) return 'audio.ogg';
	if (type.includes('mpeg') || type.includes('mp3')) return 'audio.mp3';
	if (type.includes('wav')) return 'audio.wav';
	if (type.includes('flac')) return 'audio.flac';
	return 'audio.webm';
}
