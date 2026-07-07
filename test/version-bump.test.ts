import { describe, expect, it } from 'vitest';
import { shouldRecordVersion } from '../version-bump.mjs';

describe('shouldRecordVersion', () => {
	// Regression test: the original guard checked `!Object.values(versions).includes(minAppVersion)`,
	// which meant once ANY prior release shared the same minAppVersion, no new release version was
	// ever recorded again (checked the wrong dimension: value instead of key).
	it('returns true for a target version not yet present as a key', () => {
		expect(shouldRecordVersion('1.2.0', { '1.0.0': '1.4.4', '1.1.0': '1.4.4' })).toBe(true);
	});

	it('returns false when the target version is already a key', () => {
		expect(shouldRecordVersion('1.1.0', { '1.0.0': '1.4.4', '1.1.0': '1.4.4' })).toBe(false);
	});

	it('returns true even when minAppVersion repeats across releases', () => {
		// This is exactly the case that broke: several releases in a row share one minAppVersion.
		const versions = { '1.0.0': '1.4.4', '1.1.0': '1.4.4', '1.1.1': '1.4.4' };
		expect(shouldRecordVersion('1.1.2', versions)).toBe(true);
	});

	it('returns true for the very first version against an empty map', () => {
		expect(shouldRecordVersion('1.0.0', {})).toBe(true);
	});
});
