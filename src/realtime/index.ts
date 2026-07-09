import { TranscriptionConfig, TranscriptionProviderID } from '../types';
import { createDeepgramRealtime } from './deepgram';
import { createAssemblyAIRealtime } from './assemblyai';

// Callbacks a realtime session fires as the stream progresses. onFinal receives
// finalized segments (safe to insert into the note); onInterim receives the
// rolling in-progress hypothesis (display-only, superseded by later events).
export interface RealtimeSessionCallbacks {
	onFinal(text: string): void;
	onInterim(text: string): void;
	onError(error: Error): void;
	// The server closed the socket without stop() being called.
	onUnexpectedClose(): void;
}

export interface RealtimeSession {
	// Push one chunk of 16-bit mono PCM at the session sample rate.
	sendAudio(chunk: ArrayBuffer): void;
	// Graceful shutdown: tell the server the stream ended, let trailing finals
	// flush through onFinal, then close. Resolves once the socket is closed.
	stop(): Promise<void>;
}

export interface RealtimeProvider {
	readonly id: TranscriptionProviderID;
	start(
		config: TranscriptionConfig,
		sampleRate: number,
		callbacks: RealtimeSessionCallbacks,
	): Promise<RealtimeSession>;
}

// Providers with a browser-usable streaming endpoint. Deepgram authenticates a
// WebSocket via the ['token', key] subprotocol; AssemblyAI via a short-lived
// temporary token. The rest (OpenAI/Groq whisper-shape, Rev.ai async, whisper.cpp
// server) expose no realtime endpoint reachable from a WebView, so realtime mode is
// unavailable on them.
//
// Voxtral (Mistral) is deliberately NOT listed: its realtime WebSocket rejects the
// only auth a browser WebSocket can send (see src/realtime/voxtral.ts and the
// Voxtral wiki page), so it is not WebView-reachable. The adapter is kept on disk,
// unwired, for contributors who find a working browser-auth path.
export function transcriptionProviderSupportsRealtime(id: TranscriptionProviderID): boolean {
	return id === 'deepgram' || id === 'assemblyai';
}

export function createRealtimeProvider(id: TranscriptionProviderID): RealtimeProvider {
	switch (id) {
		case 'deepgram':
			return createDeepgramRealtime();
		case 'assemblyai':
			return createAssemblyAIRealtime();
		default:
			throw new Error(`Realtime transcription is not supported for ${id}. Use AssemblyAI or Deepgram.`);
	}
}

// Shared WebSocket open/close plumbing for the two adapters.
export function waitForOpen(ws: WebSocket, provider: string, timeoutMs = 10_000): Promise<void> {
	return new Promise((resolve, reject) => {
		const timer = window.setTimeout(() => {
			cleanup();
			try { ws.close(); } catch { /* best effort */ }
			reject(new Error(`${provider}: realtime connection timed out.`));
		}, timeoutMs);
		const onOpen = (): void => {
			cleanup();
			resolve();
		};
		const onErr = (): void => {
			cleanup();
			reject(new Error(`${provider}: realtime connection failed. Check your API key and network.`));
		};
		const cleanup = (): void => {
			window.clearTimeout(timer);
			ws.removeEventListener('open', onOpen);
			ws.removeEventListener('error', onErr);
		};
		ws.addEventListener('open', onOpen);
		ws.addEventListener('error', onErr);
	});
}

export function waitForClose(ws: WebSocket, timeoutMs = 5_000): Promise<void> {
	if (ws.readyState === WebSocket.CLOSED) return Promise.resolve();
	return new Promise((resolve) => {
		const timer = window.setTimeout(() => {
			try { ws.close(); } catch { /* best effort */ }
			resolve();
		}, timeoutMs);
		ws.addEventListener('close', () => {
			window.clearTimeout(timer);
			resolve();
		}, { once: true });
	});
}
