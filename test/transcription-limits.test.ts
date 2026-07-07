import { describe, expect, it } from 'vitest';
import { pollTimeoutMs, validateRecording } from '../src/transcription/limits';

const MB = 1024 * 1024;
const MIN = 60 * 1000;
const HOUR = 60 * MIN;

describe('validateRecording', () => {
	it('allows a recording exactly at the byte limit (exclusive boundary)', () => {
		expect(() => validateRecording(25 * MB, undefined, 'openai')).not.toThrow();
	});

	it('rejects a recording one byte over the limit', () => {
		expect(() => validateRecording(25 * MB + 1, undefined, 'openai')).toThrow(/25 MB limit/);
	});

	it('allows a recording exactly at the duration limit (exclusive boundary)', () => {
		expect(() => validateRecording(1 * MB, 10 * HOUR, 'assemblyai')).not.toThrow();
	});

	it('rejects a recording over the duration limit', () => {
		expect(() => validateRecording(1 * MB, 10 * HOUR + 1, 'assemblyai')).toThrow(/10 h limit|min limit/);
	});

	it('never throws for a provider with no client-side cap', () => {
		expect(() => validateRecording(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 'whisper-local')).not.toThrow();
	});

	it('ignores duration when undefined even for a duration-capped provider', () => {
		expect(() => validateRecording(1 * MB, undefined, 'assemblyai')).not.toThrow();
	});
});

describe('pollTimeoutMs', () => {
	it('falls back to the ceiling when duration is unknown', () => {
		expect(pollTimeoutMs(undefined)).toBe(2 * HOUR);
	});

	it('falls back to the ceiling for a zero or negative duration', () => {
		expect(pollTimeoutMs(0)).toBe(2 * HOUR);
		expect(pollTimeoutMs(-1)).toBe(2 * HOUR);
	});

	it('scales as floor + 2x duration for a short clip', () => {
		const oneMinute = MIN;
		expect(pollTimeoutMs(oneMinute)).toBe(MIN + oneMinute * 2);
	});

	it('clamps to the ceiling for a very long recording', () => {
		expect(pollTimeoutMs(10 * HOUR)).toBe(2 * HOUR);
	});
});
