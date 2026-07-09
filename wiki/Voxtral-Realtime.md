# Voxtral real-time transcription (tried, not shipped)

> **Status: disabled.** We reverse-engineered Mistral's **Voxtral** real-time protocol and built a working adapter, but live testing confirmed it cannot authenticate from Obsidian's WebView (see [The open problem: auth](#the-open-problem-browser-websocket-auth)). The endpoint rejects the only credential a browser `WebSocket` can present, so **Voxtral real-time is not selectable in ReWrite**. The adapter (`src/realtime/voxtral.ts`) is kept in the repo, unwired, so a contributor who finds a working browser-auth path can re-enable it by wiring it back into `createRealtimeProvider` and `transcriptionProviderSupportsRealtime`. For live dictation today, use **AssemblyAI** or **Deepgram** (see [Providers](Providers) and [Commands and menus](Commands-and-Menus)).

This page documents everything we learned, because the groundwork is real and only one piece is missing. If you know how Mistral expects a **browser** client to authenticate the realtime WebSocket, please open an issue or PR.

## What's built (but unwired)

- The full realtime **message protocol** is implemented and matches Mistral's SDK.
- Audio capture, chunking, interim/final handling, and session teardown are done.
- The independent **real-time key and model** plumbing works and is used by the shipped AssemblyAI/Deepgram paths; only the Voxtral provider itself is removed from the selectable list. Its realtime model would default to `voxtral-mini-transcribe-realtime-2602`.

## What blocked it

- **Authentication from a browser/Obsidian WebSocket.** Mistral's official SDK authenticates with an HTTP `Authorization: Bearer` header, which a browser `WebSocket` cannot set. Mistral documents no browser-usable alternative (query param, subprotocol, or a short-lived token endpoint). ReWrite tried the WebSocket subprotocol (the same trick Deepgram accepts); Mistral's server rejects the handshake, so the connection never opens. Until that is solved, the provider stays disabled.

## The protocol (reverse-engineered)

Reverse-engineered from the open-source `mistralai` Python SDK (`src/mistralai/extra/realtime/transcription.py` and `connection.py`). If Mistral publishes an official raw-WebSocket reference, prefer it over this.

**Endpoint**

```
wss://api.mistral.ai/v1/audio/transcriptions/realtime?model=voxtral-mini-transcribe-realtime-2602
```

**Audio format:** signed 16-bit little-endian PCM (`pcm_s16le`), 16 kHz, mono.

**Client → server** (JSON text frames):

| Message | Shape |
| --- | --- |
| Configure the session (send first) | `{"type":"session.update","session":{"audio_format":{"encoding":"pcm_s16le","sample_rate":16000}}}` |
| Send audio | `{"type":"input_audio.append","audio":"<base64 PCM16>"}` — max **262144 decoded bytes** per message |
| Flush pending audio | `{"type":"input_audio.flush"}` |
| End the stream | `{"type":"input_audio.end"}` |

**Server → client** (JSON):

| `type` | Meaning |
| --- | --- |
| `session.created` / `session.updated` | Handshake / config acknowledged |
| `transcription.text.delta` | `{text}` — incremental interim text (accumulate for display) |
| `transcription.done` | `{model, text}` — final transcript |
| `transcription.segment`, `transcription.language` | Segment / detected-language events |
| `error` | `{error:{message}}` |

**Notes**

- **Realtime is not compatible with diarization** (per Mistral). This fits ReWrite's model: diarization is a per-recording choice on batch transcription, and a realtime session never requests it.
- ReWrite accumulates `transcription.text.delta` events for the on-screen interim line and inserts on `transcription.done`.

## The open problem: browser WebSocket auth

This is the crux, and where community help is most valuable.

- **Why it's hard:** Browser (and Obsidian/Electron/Capacitor renderer) `WebSocket` objects cannot set arbitrary request headers, so the SDK's `Authorization: Bearer <key>` handshake is not reproducible from a plugin.
- **How other providers solve it:** Deepgram accepts the key via the `Sec-WebSocket-Protocol` subprotocol (`['token', <key>]`); AssemblyAI mints a short-lived single-use token over a normal HTTPS request and puts only that token in the WS URL query.
- **What ReWrite currently attempts:** the Deepgram-style subprotocol (`['token', <key>]`), as a best-effort guess. This is **unverified against a live Voxtral endpoint**. If it is rejected, the socket closes during the handshake and you'll see a connection error.
- **What would resolve it:** confirmation of any of — (a) a subprotocol Mistral accepts, (b) a query-param the endpoint honors (note: ReWrite's policy avoids putting long-lived keys in URLs, so a short-lived token would be preferred), or (c) a token-minting endpoint like AssemblyAI's. If you have a working browser/JS example, that answers it directly.

## How to try it (contributors only)

Because the handshake fails, **Voxtral is not in the Real-time provider dropdown** in a shipped build. To exercise the adapter you have to re-wire it in a dev build first:

1. In `src/realtime/index.ts`, add `mistral-voxtral` back to `transcriptionProviderSupportsRealtime` and add its `case` to `createRealtimeProvider` (importing `createVoxtralRealtime` from `./voxtral`).
2. Build and reload. In the profile's **Real-time transcription** section, **Mistral Voxtral** will now appear; select it, set the **Real-time API key** (your Mistral key) and optionally the **Real-time model** (defaults to `voxtral-mini-transcribe-realtime-2602`).
3. Open a Markdown note and run **Real-time transcription (start/stop)**, then speak. If the floating bar shows interim text and words land at your cursor, you found the missing auth piece: please open a PR. If the socket closes during the handshake, that is the failure we hit.

Meanwhile, use **AssemblyAI** or **Deepgram** for live dictation (both are verified). Voxtral still works great for **batch** transcription (record or reprocess a file), which is unaffected.

## For contributors

- The adapter is `src/realtime/voxtral.ts` (kept on disk, unwired); the auth attempt and the caveat are documented inline.
- The realtime interfaces (`RealtimeProvider` / `RealtimeSession`) and shared WS helpers are in `src/realtime/index.ts` (this is also where you re-enable the provider).
- The developer-facing summary lives in [CLAUDE.md](https://github.com/WiseGuru/ReWrite-Voice-Notes/blob/master/CLAUDE.md) under "Real-time transcription".

[Back to Home](Home)
