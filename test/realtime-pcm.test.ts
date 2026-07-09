import { describe, expect, it } from 'vitest';
import { downsampleBuffer, floatTo16BitPcm, REALTIME_SAMPLE_RATE } from '../src/realtime/pcm';

describe('downsampleBuffer', () => {
	it('returns the input unchanged when rates match', () => {
		const input = new Float32Array([0.1, 0.2, 0.3]);
		expect(downsampleBuffer(input, 16_000, 16_000)).toBe(input);
	});

	it('produces the expected length for a 48k -> 16k downsample', () => {
		const input = new Float32Array(4800); // 100 ms at 48 kHz
		const out = downsampleBuffer(input, 48_000, REALTIME_SAMPLE_RATE);
		expect(out.length).toBe(1600); // 100 ms at 16 kHz
	});

	it('preserves a constant signal through resampling', () => {
		const input = new Float32Array(480).fill(0.5);
		const out = downsampleBuffer(input, 48_000, 16_000);
		for (const sample of out) {
			expect(sample).toBeCloseTo(0.5, 5);
		}
	});

	it('interpolates between neighboring samples for non-integer positions', () => {
		// 44.1k -> 16k has a non-integer ratio, forcing interpolation.
		const input = new Float32Array(441);
		for (let i = 0; i < input.length; i++) input[i] = i / input.length;
		const out = downsampleBuffer(input, 44_100, 16_000);
		expect(out.length).toBe(160);
		// A linear ramp must stay monotonically non-decreasing after resampling.
		for (let i = 1; i < out.length; i++) {
			expect(out[i]).toBeGreaterThanOrEqual(out[i - 1] ?? 0);
		}
	});

	it('refuses to upsample', () => {
		expect(() => downsampleBuffer(new Float32Array(10), 8_000, 16_000)).toThrow();
	});
});

describe('floatTo16BitPcm', () => {
	it('maps the float range onto signed 16-bit', () => {
		const out = floatTo16BitPcm(new Float32Array([0, 1, -1]));
		expect(out[0]).toBe(0);
		expect(out[1]).toBe(0x7fff);
		expect(out[2]).toBe(-0x8000);
	});

	it('clamps out-of-range samples instead of wrapping', () => {
		const out = floatTo16BitPcm(new Float32Array([2.5, -2.5]));
		expect(out[0]).toBe(0x7fff);
		expect(out[1]).toBe(-0x8000);
	});

	it('quantizes mid-range values proportionally', () => {
		const out = floatTo16BitPcm(new Float32Array([0.5, -0.5]));
		expect(out[0]).toBe(Math.round(0.5 * 0x7fff));
		expect(out[1]).toBe(Math.round(-0.5 * 0x8000));
	});
});
