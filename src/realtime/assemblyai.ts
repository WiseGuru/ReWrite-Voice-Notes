import { TranscriptionConfig } from '../types';
import { jsonGet } from '../http';
import { RealtimeProvider, RealtimeSession, RealtimeSessionCallbacks, waitForClose, waitForOpen } from './index';

interface TokenResponse {
	token?: string;
}

interface StreamingMessage {
	type?: string;
	transcript?: string;
	end_of_turn?: boolean;
	turn_is_formatted?: boolean;
	error?: string;
}

const TOKEN_URL = 'https://streaming.assemblyai.com/v3/token?expires_in_seconds=60';
const WS_BASE = 'wss://streaming.assemblyai.com/v3/ws';

// AssemblyAI Universal-Streaming (v3) over WebSocket. Browser WebSockets cannot
// set an Authorization header, so per AssemblyAI's documented browser flow the
// real API key first buys a SHORT-LIVED single-use token over a normal
// header-authenticated request, and only that ephemeral token rides the WS URL
// query. This is the one sanctioned exception to the "auth never goes in the
// query" rule (see the HTTP gotchas in CLAUDE.md): the value expires in 60 s
// and cannot mint further tokens, and no error path echoes the URL.
export function createAssemblyAIRealtime(): RealtimeProvider {
	return {
		id: 'assemblyai',
		async start(
			config: TranscriptionConfig,
			sampleRate: number,
			callbacks: RealtimeSessionCallbacks,
		): Promise<RealtimeSession> {
			if (!config.apiKey) throw new Error('assemblyai: API key is not configured');
			const tokenRes = await jsonGet<TokenResponse>(
				'assemblyai',
				TOKEN_URL,
				{ Authorization: config.apiKey },
			);
			if (!tokenRes.token) {
				throw new Error('assemblyai: could not get a realtime session token. Realtime streaming may require a funded account.');
			}

			const params = new URLSearchParams({
				sample_rate: String(sampleRate),
				encoding: 'pcm_s16le',
				// The server re-sends each finished turn once more with punctuation
				// and casing applied; only that formatted event is treated as final.
				format_turns: 'true',
				token: tokenRes.token,
			});
			const ws = new WebSocket(`${WS_BASE}?${params.toString()}`);
			ws.binaryType = 'arraybuffer';
			let stopping = false;

			ws.addEventListener('message', (ev: MessageEvent) => {
				if (typeof ev.data !== 'string') return;
				let msg: StreamingMessage;
				try {
					msg = JSON.parse(ev.data) as StreamingMessage;
				} catch {
					return;
				}
				if (msg.type === 'Turn') {
					const transcript = (msg.transcript ?? '').trim();
					if (!transcript) return;
					// With format_turns on, an unformatted end-of-turn precedes the
					// formatted one; treating only the formatted event as final keeps
					// each turn from being inserted twice.
					if (msg.end_of_turn && msg.turn_is_formatted) callbacks.onFinal(transcript);
					else callbacks.onInterim(transcript);
					return;
				}
				if (msg.type === 'Error' && !stopping) {
					callbacks.onError(new Error(`assemblyai: ${msg.error ?? 'realtime session error'}`));
				}
			});
			ws.addEventListener('error', () => {
				if (!stopping) callbacks.onError(new Error('assemblyai: realtime connection error.'));
			});
			ws.addEventListener('close', () => {
				if (!stopping) callbacks.onUnexpectedClose();
			});

			await waitForOpen(ws, 'assemblyai');

			return {
				sendAudio(chunk: ArrayBuffer): void {
					if (ws.readyState === WebSocket.OPEN) ws.send(chunk);
				},
				async stop(): Promise<void> {
					stopping = true;
					// Terminate flushes the last turn (delivered through the message
					// handler while we wait), then the server closes the socket.
					try {
						if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'Terminate' }));
					} catch { /* best effort */ }
					await waitForClose(ws);
				},
			};
		},
	};
}
