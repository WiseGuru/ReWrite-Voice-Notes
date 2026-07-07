export const TARGET_SAMPLE_RATE = 16000;

function abortIfSignaled(signal: AbortSignal | undefined): void {
	if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
}

// Decode + offline render can take multiple seconds for a long recording, with no
// cancellation checks of its own; check the signal around each stage so a cancel requested
// during transcode is observed promptly instead of only at the subsequent upload.
export async function transcodeToWavPcm(
	audio: Blob,
	targetSampleRate: number = TARGET_SAMPLE_RATE,
	signal?: AbortSignal,
): Promise<ArrayBuffer> {
	abortIfSignaled(signal);
	const input = await audio.arrayBuffer();
	abortIfSignaled(signal);
	const decoded = await decodeAudio(input);
	abortIfSignaled(signal);
	const resampled = await resampleToMono(decoded, targetSampleRate);
	abortIfSignaled(signal);
	return encodeWav16(resampled, targetSampleRate);
}

async function decodeAudio(buffer: ArrayBuffer): Promise<AudioBuffer> {
	const Ctx = (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
	if (!Ctx) throw new Error('Web Audio API is unavailable in this environment.');
	const ctx = new Ctx();
	try {
		return await ctx.decodeAudioData(buffer.slice(0));
	} finally {
		try { await ctx.close(); } catch { /* best effort */ }
	}
}

async function resampleToMono(input: AudioBuffer, targetSampleRate: number): Promise<Float32Array> {
	const targetLength = Math.max(1, Math.ceil(input.duration * targetSampleRate));
	const offline = new OfflineAudioContext(1, targetLength, targetSampleRate);
	const source = offline.createBufferSource();
	source.buffer = input;
	source.connect(offline.destination);
	source.start();
	const rendered = await offline.startRendering();
	return rendered.getChannelData(0);
}

function encodeWav16(samples: Float32Array, sampleRate: number): ArrayBuffer {
	const numChannels = 1;
	const bytesPerSample = 2;
	const blockAlign = numChannels * bytesPerSample;
	const byteRate = sampleRate * blockAlign;
	const dataSize = samples.length * bytesPerSample;
	const buffer = new ArrayBuffer(44 + dataSize);
	const view = new DataView(buffer);
	writeAscii(view, 0, 'RIFF');
	view.setUint32(4, 36 + dataSize, true);
	writeAscii(view, 8, 'WAVE');
	writeAscii(view, 12, 'fmt ');
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, numChannels, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, byteRate, true);
	view.setUint16(32, blockAlign, true);
	view.setUint16(34, bytesPerSample * 8, true);
	writeAscii(view, 36, 'data');
	view.setUint32(40, dataSize, true);
	let offset = 44;
	for (let i = 0; i < samples.length; i++) {
		const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
		view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
		offset += 2;
	}
	return buffer;
}

function writeAscii(view: DataView, offset: number, value: string): void {
	for (let i = 0; i < value.length; i++) {
		view.setUint8(offset + i, value.charCodeAt(i));
	}
}
