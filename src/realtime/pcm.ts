// Live raw-PCM microphone capture for the realtime transcription mode.
// MediaRecorder produces containerized chunks (webm/mp4) that streaming STT
// endpoints cannot consume mid-stream, so this taps the mic with a
// ScriptProcessorNode (deprecated but universally available in every WebView
// Obsidian runs in, and needs no external worklet module, which the app CSP
// would complicate), downsamples to the session rate, and emits 16-bit PCM.

export const REALTIME_SAMPLE_RATE = 16_000;

// Linear-interpolation resample. Pure; exported for tests. Returns the input
// unchanged when the rates already match.
export function downsampleBuffer(input: Float32Array, inRate: number, outRate: number): Float32Array {
	if (inRate === outRate) return input;
	if (inRate < outRate) {
		throw new Error(`downsampleBuffer: cannot upsample ${inRate} -> ${outRate}`);
	}
	const ratio = inRate / outRate;
	const outLength = Math.floor(input.length / ratio);
	const out = new Float32Array(outLength);
	for (let i = 0; i < outLength; i++) {
		const pos = i * ratio;
		const left = Math.floor(pos);
		const right = Math.min(left + 1, input.length - 1);
		const frac = pos - left;
		out[i] = (input[left] ?? 0) * (1 - frac) + (input[right] ?? 0) * frac;
	}
	return out;
}

// Clamp and quantize float samples (-1..1) to signed 16-bit little-endian PCM.
// Pure; exported for tests.
export function floatTo16BitPcm(input: Float32Array): Int16Array {
	const out = new Int16Array(input.length);
	for (let i = 0; i < input.length; i++) {
		const s = Math.max(-1, Math.min(1, input[i] ?? 0));
		out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
	}
	return out;
}

export function isPcmCaptureAvailable(): boolean {
	const hasCtx = typeof window !== 'undefined'
		&& (typeof window.AudioContext !== 'undefined'
			|| typeof (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext !== 'undefined');
	return hasCtx && typeof navigator !== 'undefined' && !!navigator.mediaDevices;
}

export class PcmCapture {
	private stream: MediaStream | null = null;
	private context: AudioContext | null = null;
	private source: MediaStreamAudioSourceNode | null = null;
	// ScriptProcessorNode is deprecated in favor of AudioWorklet, but a worklet
	// must be loaded as a separate module (addModule(url)), which a single-file
	// bundled Obsidian plugin cannot ship and the app CSP complicates via blob
	// URLs. ScriptProcessor remains supported in every WebView Obsidian runs in;
	// revisit if it is ever actually removed.
	// eslint-disable-next-line @typescript-eslint/no-deprecated
	private processor: ScriptProcessorNode | null = null;
	private silentGain: GainNode | null = null;

	// Opens the mic and begins emitting 16 kHz mono Int16 PCM chunks. The chunk
	// size follows the processor buffer (4096 frames at the context rate, so
	// roughly 85 ms at 48 kHz — within every provider's accepted frame range).
	async start(onChunk: (chunk: ArrayBuffer) => void): Promise<void> {
		if (this.context) throw new Error('PcmCapture already started.');
		let stream: MediaStream;
		try {
			stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			throw new Error(`Microphone access denied: ${msg}`);
		}
		const Ctx = window.AudioContext
			?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
		if (!Ctx) {
			for (const track of stream.getTracks()) track.stop();
			throw new Error('Web Audio is unavailable; realtime capture cannot run here.');
		}
		const context = new Ctx();
		// The instance fields are assigned only once every node is wired up (all-or-nothing),
		// so if any setup call below throws, `this.context` is still null and stop() cannot
		// reach the just-created context. Close it (and release the mic) here so a partial
		// start never leaks an AudioContext or a live mic track.
		try {
			const source = context.createMediaStreamSource(stream);
			// See the deprecation note on the `processor` field for why ScriptProcessor
			// is used instead of AudioWorklet.
			// eslint-disable-next-line @typescript-eslint/no-deprecated
			const processor = context.createScriptProcessor(4096, 1, 1);
			// eslint-disable-next-line @typescript-eslint/no-deprecated
			processor.onaudioprocess = (ev) => {
				// eslint-disable-next-line @typescript-eslint/no-deprecated
				const data = ev.inputBuffer.getChannelData(0);
				const down = downsampleBuffer(data, context.sampleRate, REALTIME_SAMPLE_RATE);
				const pcm = floatTo16BitPcm(down);
				onChunk(pcm.buffer);
			};
			// A ScriptProcessorNode only runs while connected to the destination. Route
			// it through a zero-gain node so nothing is audible (the output buffer is
			// silence anyway; the gain is belt-and-braces against feedback).
			const gain = context.createGain();
			gain.gain.value = 0;
			source.connect(processor);
			processor.connect(gain);
			gain.connect(context.destination);

			this.stream = stream;
			this.context = context;
			this.source = source;
			this.processor = processor;
			this.silentGain = gain;
		} catch (e) {
			void context.close().catch(() => { /* best effort */ });
			for (const track of stream.getTracks()) track.stop();
			throw e;
		}
	}

	stop(): void {
		// eslint-disable-next-line @typescript-eslint/no-deprecated
		if (this.processor) this.processor.onaudioprocess = null;
		try { this.source?.disconnect(); } catch { /* best effort */ }
		try { this.processor?.disconnect(); } catch { /* best effort */ }
		try { this.silentGain?.disconnect(); } catch { /* best effort */ }
		if (this.context) {
			void this.context.close().catch(() => { /* best effort */ });
		}
		if (this.stream) {
			for (const track of this.stream.getTracks()) track.stop();
		}
		this.stream = null;
		this.context = null;
		this.source = null;
		this.processor = null;
		this.silentGain = null;
	}
}
