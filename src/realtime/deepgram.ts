import { TranscriptionConfig } from '../types';
import { RealtimeProvider, RealtimeSession, RealtimeSessionCallbacks, waitForClose, waitForOpen } from './index';

interface DeepgramLiveMessage {
	type?: string;
	is_final?: boolean;
	channel?: {
		alternatives?: Array<{ transcript?: string }>;
	};
}

// Deepgram live STT over WebSocket. Auth rides the ['token', <key>] WebSocket
// subprotocol — the browser-supported equivalent of the Authorization header
// (browser WebSockets cannot set custom headers), so the key never appears in
// the URL. Results arrive as JSON messages; is_final marks a finalized segment.
export function createDeepgramRealtime(): RealtimeProvider {
	return {
		id: 'deepgram',
		async start(
			config: TranscriptionConfig,
			sampleRate: number,
			callbacks: RealtimeSessionCallbacks,
		): Promise<RealtimeSession> {
			if (!config.apiKey) throw new Error('deepgram: API key is not configured');
			const params = new URLSearchParams({
				encoding: 'linear16',
				sample_rate: String(sampleRate),
				channels: '1',
				interim_results: 'true',
				smart_format: 'true',
			});
			// The profile's batch model generally works for live too (nova family);
			// when empty, Deepgram's server-side default applies.
			if (config.model) params.set('model', config.model);
			if (config.language) params.set('language', config.language);

			const ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${params.toString()}`, ['token', config.apiKey]);
			ws.binaryType = 'arraybuffer';
			let stopping = false;

			ws.addEventListener('message', (ev: MessageEvent) => {
				if (typeof ev.data !== 'string') return;
				let msg: DeepgramLiveMessage;
				try {
					msg = JSON.parse(ev.data) as DeepgramLiveMessage;
				} catch {
					return;
				}
				if (msg.type !== 'Results') return;
				const transcript = msg.channel?.alternatives?.[0]?.transcript ?? '';
				if (!transcript.trim()) return;
				if (msg.is_final) callbacks.onFinal(transcript.trim());
				else callbacks.onInterim(transcript.trim());
			});
			ws.addEventListener('error', () => {
				if (!stopping) callbacks.onError(new Error('deepgram: realtime connection error.'));
			});
			ws.addEventListener('close', () => {
				if (!stopping) callbacks.onUnexpectedClose();
			});

			await waitForOpen(ws, 'deepgram');

			return {
				sendAudio(chunk: ArrayBuffer): void {
					if (ws.readyState === WebSocket.OPEN) ws.send(chunk);
				},
				async stop(): Promise<void> {
					stopping = true;
					// CloseStream tells Deepgram to flush pending finals, then close;
					// trailing Results still dispatch through the message handler while
					// we wait for the close.
					try {
						if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'CloseStream' }));
					} catch { /* best effort */ }
					await waitForClose(ws);
				},
			};
		},
	};
}
