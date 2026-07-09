import { TranscriptionConfig } from '../types';
import { MultipartPart, multipartPost, ProviderError } from '../http';
import { transcodeToWavPcm } from '../audio-transcode';
import { TranscriptionProvider } from './index';
import type { WhisperHost } from '../whisper-host';

let host: WhisperHost | null = null;

export function bindWhisperHost(h: WhisperHost): void {
	host = h;
}

export function createWhisperLocalTranscription(): TranscriptionProvider {
	return {
		id: 'whisper-local',
		requiresAudio: true,
		async transcribe(
			audio: Blob,
			config: TranscriptionConfig,
			signal?: AbortSignal,
		): Promise<string> {
			if (!host) {
				throw new ProviderError('whisper-local', 0, '', 'Local whisper.cpp server is not initialized (desktop only).');
			}
			const baseUrl = host.baseUrl();
			if (!baseUrl) {
				throw new ProviderError('whisper-local', 0, '', 'Local whisper.cpp server is not reachable. Start it from settings, or check whether the configured port is bound.');
			}
			// Bracket the whole request (including the transcode) so the idle-stop
			// timer neither counts an in-flight transcription as idle time nor stops
			// the server mid-job.
			host.beginUse();
			try {
				return await transcribeAgainstHost(baseUrl, audio, config, signal);
			} finally {
				host.endUse();
			}
		},
	};
}

async function transcribeAgainstHost(
	baseUrl: string,
	audio: Blob,
	config: TranscriptionConfig,
	signal?: AbortSignal,
): Promise<string> {
	let wavBuffer: ArrayBuffer;
	try {
		wavBuffer = await transcodeToWavPcm(audio, undefined, signal);
	} catch (e) {
		if (e instanceof DOMException && e.name === 'AbortError') throw e;
		const msg = e instanceof Error ? e.message : String(e);
		throw new ProviderError('whisper-local', 0, '', `Failed to transcode audio to WAV for whisper.cpp: ${msg}`);
	}
	const parts: MultipartPart[] = [
		{
			type: 'file',
			name: 'file',
			filename: 'audio.wav',
			contentType: 'audio/wav',
			data: wavBuffer,
		},
		{ type: 'text', name: 'response_format', value: 'text' },
	];
	if (config.language) {
		parts.push({ type: 'text', name: 'language', value: config.language });
	}
	const res = await multipartPost(
		'whisper-local',
		`${baseUrl}/inference`,
		parts,
		{},
		signal,
	);
	return res.text.trim();
}
