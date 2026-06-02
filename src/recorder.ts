import { RecordingFormatPreference } from './types';

export type RecorderState = 'idle' | 'recording' | 'paused' | 'stopped';

export interface RecorderResult {
	blob: Blob;
	mimeType: string;
	durationMs: number;
}

const WEBM_FIRST: string[] = [
	'audio/webm;codecs=opus',
	'audio/webm',
	'audio/ogg;codecs=opus',
	'audio/mp4',
];

const MP4_FIRST: string[] = [
	'audio/mp4',
	'audio/webm;codecs=opus',
	'audio/webm',
	'audio/ogg;codecs=opus',
];

// Peak amplitude (0..1, deviation from silence) below which a sample counts as silence.
// Mute / a dead mic sits near 0; even quiet speech clears this comfortably.
const SILENCE_LEVEL_THRESHOLD = 0.015;
// How often the level monitor samples the analyser while recording.
const LEVEL_SAMPLE_INTERVAL_MS = 100;

export function getBestMimeType(preference: RecordingFormatPreference): string {
	if (typeof MediaRecorder === 'undefined') return '';
	const candidates = preference === 'mp4' ? MP4_FIRST : WEBM_FIRST;
	for (const candidate of candidates) {
		if (MediaRecorder.isTypeSupported(candidate)) return candidate;
	}
	return '';
}

export class Recorder {
	private mediaRecorder: MediaRecorder | null = null;
	private stream: MediaStream | null = null;
	private chunks: Blob[] = [];
	private state: RecorderState = 'idle';
	private startedAt = 0;
	private accumulatedMs = 0;
	private mimeType = '';

	// Live input-level monitoring (so the UI can warn about a muted / dead mic).
	private audioContext: AudioContext | null = null;
	private analyser: AnalyserNode | null = null;
	private sourceNode: MediaStreamAudioSourceNode | null = null;
	private levelData: Uint8Array | null = null;
	private levelTimer: number | null = null;
	private currentLevel = 0;
	private lastSoundAt = 0;
	private soundDetected = false;

	getState(): RecorderState {
		return this.state;
	}

	getElapsedMs(): number {
		if (this.state === 'recording') {
			return this.accumulatedMs + (Date.now() - this.startedAt);
		}
		return this.accumulatedMs;
	}

	/** Most recent input level, 0..1 (peak deviation from silence). */
	getInputLevel(): number {
		return this.currentLevel;
	}

	/** Whether any audio above the silence threshold has been heard since recording began. */
	hasDetectedSound(): boolean {
		return this.soundDetected;
	}

	/**
	 * Milliseconds of continuous silence up to now. Returns 0 while paused / not
	 * recording (so the UI does not warn when there is nothing to listen to) and
	 * when the level monitor could not be created.
	 */
	getSilentMs(): number {
		if (this.state !== 'recording' || !this.analyser) return 0;
		return Date.now() - this.lastSoundAt;
	}

	async start(preference: RecordingFormatPreference): Promise<void> {
		if (this.state !== 'idle') {
			throw new Error(`Recorder.start: invalid transition from ${this.state}`);
		}
		let stream: MediaStream;
		try {
			stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			throw new Error(`Microphone access denied: ${msg}`);
		}
		const mimeType = getBestMimeType(preference);
		let recorder: MediaRecorder;
		try {
			recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
		} catch (e) {
			for (const track of stream.getTracks()) track.stop();
			const msg = e instanceof Error ? e.message : String(e);
			throw new Error(`Failed to start MediaRecorder: ${msg}`);
		}
		this.stream = stream;
		this.mediaRecorder = recorder;
		this.mimeType = mimeType;
		this.chunks = [];
		recorder.addEventListener('dataavailable', (ev) => {
			if (ev.data && ev.data.size > 0) this.chunks.push(ev.data);
		});
		this.startedAt = Date.now();
		this.accumulatedMs = 0;
		this.state = 'recording';
		this.startLevelMonitor(stream);
		recorder.start();
	}

	pause(): void {
		if (this.state !== 'recording') {
			throw new Error(`Recorder.pause: invalid transition from ${this.state}`);
		}
		if (!this.mediaRecorder) throw new Error('Recorder.pause: missing MediaRecorder');
		this.accumulatedMs += Date.now() - this.startedAt;
		this.mediaRecorder.pause();
		this.state = 'paused';
	}

	resume(): void {
		if (this.state !== 'paused') {
			throw new Error(`Recorder.resume: invalid transition from ${this.state}`);
		}
		if (!this.mediaRecorder) throw new Error('Recorder.resume: missing MediaRecorder');
		this.mediaRecorder.resume();
		this.startedAt = Date.now();
		// Don't count the paused gap as silence.
		this.lastSoundAt = Date.now();
		this.state = 'recording';
	}

	async stop(): Promise<RecorderResult> {
		if (this.state !== 'recording' && this.state !== 'paused') {
			throw new Error(`Recorder.stop: invalid transition from ${this.state}`);
		}
		const recorder = this.mediaRecorder;
		if (!recorder) throw new Error('Recorder.stop: missing MediaRecorder');
		if (this.state === 'recording') {
			this.accumulatedMs += Date.now() - this.startedAt;
		}
		const finished = new Promise<void>((resolve) => {
			recorder.addEventListener('stop', () => resolve(), { once: true });
		});
		recorder.stop();
		await finished;
		this.state = 'stopped';
		this.releaseStream();
		const firstChunk = this.chunks[0];
		const type = this.mimeType || (firstChunk ? firstChunk.type : '') || 'audio/webm';
		const blob = new Blob(this.chunks, { type });
		return { blob, mimeType: type, durationMs: this.accumulatedMs };
	}

	cancel(): void {
		if (this.mediaRecorder && (this.state === 'recording' || this.state === 'paused')) {
			try {
				this.mediaRecorder.stop();
			} catch {
				// ignore
			}
		}
		this.releaseStream();
		this.chunks = [];
		this.state = 'idle';
		this.accumulatedMs = 0;
		this.startedAt = 0;
		this.mediaRecorder = null;
	}

	private releaseStream(): void {
		this.stopLevelMonitor();
		if (this.stream) {
			for (const track of this.stream.getTracks()) track.stop();
			this.stream = null;
		}
	}

	private startLevelMonitor(stream: MediaStream): void {
		this.currentLevel = 0;
		this.soundDetected = false;
		this.lastSoundAt = Date.now();
		const Ctx = window.AudioContext
			?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
		if (!Ctx) return; // No Web Audio: silence detection is simply unavailable.
		try {
			const ctx = new Ctx();
			const source = ctx.createMediaStreamSource(stream);
			const analyser = ctx.createAnalyser();
			analyser.fftSize = 1024;
			source.connect(analyser); // Not connected to destination, so no monitoring feedback.
			this.audioContext = ctx;
			this.sourceNode = source;
			this.analyser = analyser;
			this.levelData = new Uint8Array(analyser.fftSize);
			this.levelTimer = window.setInterval(() => this.sampleLevel(), LEVEL_SAMPLE_INTERVAL_MS);
		} catch {
			// Treat any setup failure as "monitoring unavailable" rather than failing the recording.
			this.teardownLevelNodes();
		}
	}

	private sampleLevel(): void {
		if (this.state !== 'recording' || !this.analyser || !this.levelData) return;
		this.analyser.getByteTimeDomainData(this.levelData);
		let peak = 0;
		for (let i = 0; i < this.levelData.length; i++) {
			const deviation = Math.abs((this.levelData[i] ?? 128) - 128);
			if (deviation > peak) peak = deviation;
		}
		this.currentLevel = peak / 128;
		if (this.currentLevel >= SILENCE_LEVEL_THRESHOLD) {
			this.lastSoundAt = Date.now();
			this.soundDetected = true;
		}
	}

	private stopLevelMonitor(): void {
		if (this.levelTimer !== null) {
			window.clearInterval(this.levelTimer);
			this.levelTimer = null;
		}
		this.teardownLevelNodes();
		this.currentLevel = 0;
	}

	private teardownLevelNodes(): void {
		try { this.sourceNode?.disconnect(); } catch { /* best effort */ }
		try { this.analyser?.disconnect(); } catch { /* best effort */ }
		if (this.audioContext) {
			void this.audioContext.close().catch(() => { /* best effort */ });
		}
		this.sourceNode = null;
		this.analyser = null;
		this.audioContext = null;
		this.levelData = null;
	}
}
