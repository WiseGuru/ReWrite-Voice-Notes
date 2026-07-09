import { TranscriptionConfig } from '../types';
import { RealtimeProvider, RealtimeSession, RealtimeSessionCallbacks, waitForClose, waitForOpen } from './index';

// STATUS (v1.2.0): UNWIRED. This adapter is intentionally not referenced by
// src/realtime/index.ts (not in the factory or the realtime-capable gate), so it is
// not bundled or user-selectable. Live testing confirmed the AUTH CAVEAT below: the
// realtime handshake fails with the only auth a browser WebSocket can send, so Voxtral
// realtime is not WebView-reachable. The file is kept as a documented starting point
// for a contributor who finds a working browser-auth path (see the Voxtral wiki page).
// To re-enable, add it back to createRealtimeProvider + transcriptionProviderSupportsRealtime.
//
// Mistral Voxtral realtime STT over WebSocket. Protocol reverse-engineered from the
// mistralai Python SDK (src/mistralai/extra/realtime/{transcription,connection}.py):
//   URL:   wss://api.mistral.ai/v1/audio/transcriptions/realtime?model=<model>
//   send:  {"type":"session.update","session":{"audio_format":{"encoding":"pcm_s16le","sample_rate":N}}}
//          {"type":"input_audio.append","audio":"<base64 PCM16>"}  (max 262144 decoded bytes/msg)
//          {"type":"input_audio.flush"} then {"type":"input_audio.end"} to finish
//   recv:  transcription.text.delta {text}  (interim, incremental)
//          transcription.done {text}         (final)
//          error {error:{message}}
//
// AUTH CAVEAT: the SDK authenticates with an `Authorization: Bearer` HTTP header, which a
// browser/WebView WebSocket cannot set. Mistral does not document a browser-usable auth for
// this endpoint. As a best-effort attempt (to be validated against a live key), the key is
// passed via the Sec-WebSocket-Protocol subprotocol, the same browser-safe pattern the
// Deepgram adapter uses (key stays off the URL). If the server rejects the handshake, Voxtral
// realtime is not reachable from a WebView and this adapter should be removed.
const DEFAULT_REALTIME_MODEL = 'voxtral-mini-transcribe-realtime-2602';
const MAX_APPEND_BYTES = 262144;

interface VoxtralEvent {
	type?: string;
	text?: string;
	error?: { message?: string } | string;
}

function bytesToBase64(bytes: Uint8Array): string {
	let binary = '';
	for (let i = 0; i < bytes.length; i++) {
		binary += String.fromCharCode(bytes[i] ?? 0);
	}
	return btoa(binary);
}

export function createVoxtralRealtime(): RealtimeProvider {
	return {
		id: 'mistral-voxtral',
		async start(
			config: TranscriptionConfig,
			sampleRate: number,
			callbacks: RealtimeSessionCallbacks,
		): Promise<RealtimeSession> {
			if (!config.apiKey) throw new Error('mistral-voxtral: realtime API key is not configured');
			const model = config.model || DEFAULT_REALTIME_MODEL;
			const url = `wss://api.mistral.ai/v1/audio/transcriptions/realtime?model=${encodeURIComponent(model)}`;

			const ws = new WebSocket(url, ['token', config.apiKey]);
			ws.binaryType = 'arraybuffer';
			let stopping = false;
			// Voxtral streams incremental text.delta events; accumulate them for the rolling
			// interim display and clear on each terminal transcription.done.
			let interim = '';

			ws.addEventListener('message', (ev: MessageEvent) => {
				if (typeof ev.data !== 'string') return;
				let msg: VoxtralEvent;
				try {
					msg = JSON.parse(ev.data) as VoxtralEvent;
				} catch {
					return;
				}
				switch (msg.type) {
					case 'transcription.text.delta':
						if (typeof msg.text === 'string') {
							interim += msg.text;
							if (interim.trim()) callbacks.onInterim(interim.trim());
						}
						break;
					case 'transcription.done': {
						const finalText = typeof msg.text === 'string' && msg.text.trim() ? msg.text.trim() : interim.trim();
						interim = '';
						if (finalText) callbacks.onFinal(finalText);
						break;
					}
					case 'error': {
						const em = typeof msg.error === 'string' ? msg.error : msg.error?.message;
						if (!stopping) callbacks.onError(new Error(`mistral-voxtral: ${em ?? 'realtime error'}`));
						break;
					}
				}
			});
			ws.addEventListener('error', () => {
				if (!stopping) callbacks.onError(new Error('mistral-voxtral: realtime connection error (if this is an auth failure, Voxtral realtime may not support browser WebSocket auth).'));
			});
			ws.addEventListener('close', () => {
				if (!stopping) callbacks.onUnexpectedClose();
			});

			await waitForOpen(ws, 'mistral-voxtral');

			// Set the audio format before any audio is sent.
			ws.send(JSON.stringify({
				type: 'session.update',
				session: { audio_format: { encoding: 'pcm_s16le', sample_rate: sampleRate } },
			}));

			return {
				sendAudio(chunk: ArrayBuffer): void {
					if (ws.readyState !== WebSocket.OPEN) return;
					const bytes = new Uint8Array(chunk);
					// Split anything over the per-message decoded-byte cap (capture chunks are
					// far smaller, so this rarely triggers).
					for (let off = 0; off < bytes.length; off += MAX_APPEND_BYTES) {
						const slice = bytes.subarray(off, Math.min(off + MAX_APPEND_BYTES, bytes.length));
						ws.send(JSON.stringify({ type: 'input_audio.append', audio: bytesToBase64(slice) }));
					}
				},
				async stop(): Promise<void> {
					stopping = true;
					try {
						if (ws.readyState === WebSocket.OPEN) {
							ws.send(JSON.stringify({ type: 'input_audio.flush' }));
							ws.send(JSON.stringify({ type: 'input_audio.end' }));
						}
					} catch { /* best effort */ }
					// Trailing transcription.done still dispatches through the message handler
					// while we wait for the close (or the waitForClose timeout force-closes).
					await waitForClose(ws);
				},
			};
		},
	};
}
