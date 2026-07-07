import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, mergeSettings } from '../src/settings';

describe('mergeSettings', () => {
	it('keeps defaults when partial is empty', () => {
		const merged = mergeSettings(DEFAULT_SETTINGS, {});
		expect(merged).toEqual(DEFAULT_SETTINGS);
	});

	it('accepts a valid enum override', () => {
		const merged = mergeSettings(DEFAULT_SETTINGS, { recordingFormat: 'mp4' });
		expect(merged.recordingFormat).toBe('mp4');
	});

	// Regression test: a corrupt/hand-edited data.json could carry garbage for an enum field.
	// mergeSettings must fall back to the base value rather than propagate it, since spreading a
	// non-object partial field over a nested config (or accepting an unrecognized enum string)
	// would otherwise leak garbage into runtime state.
	it('falls back to the base value for an invalid enum string', () => {
		const merged = mergeSettings(DEFAULT_SETTINGS, {
			// @ts-expect-error deliberately invalid to simulate a corrupt data.json
			recordingFormat: 'not-a-real-format',
		});
		expect(merged.recordingFormat).toBe(DEFAULT_SETTINGS.recordingFormat);
	});

	it('falls back to the base transcriptionProvider for an invalid profile enum', () => {
		const merged = mergeSettings(DEFAULT_SETTINGS, {
			desktopProfile: {
				...DEFAULT_SETTINGS.desktopProfile,
				// @ts-expect-error deliberately invalid
				transcriptionProvider: 'not-a-real-provider',
			},
		});
		expect(merged.desktopProfile.transcriptionProvider).toBe(DEFAULT_SETTINGS.desktopProfile.transcriptionProvider);
	});

	it('does not spread a non-object localWhisper into the base config', () => {
		const merged = mergeSettings(DEFAULT_SETTINGS, {
			// @ts-expect-error deliberately invalid to simulate a corrupt data.json
			localWhisper: 'garbage-string',
		});
		expect(merged.localWhisper).toEqual(DEFAULT_SETTINGS.localWhisper);
	});

	it('does not spread a non-object transcriptionConfig into the base profile config', () => {
		const merged = mergeSettings(DEFAULT_SETTINGS, {
			desktopProfile: {
				...DEFAULT_SETTINGS.desktopProfile,
				// @ts-expect-error deliberately invalid
				transcriptionConfig: 'garbage-string',
			},
		});
		expect(merged.desktopProfile.transcriptionConfig).toEqual(DEFAULT_SETTINGS.desktopProfile.transcriptionConfig);
	});

	it('merges a partial nested config over the base rather than replacing it wholesale', () => {
		const merged = mergeSettings(DEFAULT_SETTINGS, {
			desktopProfile: {
				...DEFAULT_SETTINGS.desktopProfile,
				transcriptionConfig: { ...DEFAULT_SETTINGS.desktopProfile.transcriptionConfig, model: 'whisper-1' },
			},
		});
		expect(merged.desktopProfile.transcriptionConfig.model).toBe('whisper-1');
		expect(merged.desktopProfile.transcriptionConfig.baseUrl).toBe(DEFAULT_SETTINGS.desktopProfile.transcriptionConfig.baseUrl);
	});
});
