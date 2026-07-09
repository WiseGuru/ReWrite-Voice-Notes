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

	it('provides and merges the separate realtime provider + config slot', () => {
		const base = mergeSettings(DEFAULT_SETTINGS, {});
		expect(base.desktopProfile.realtimeProvider).toBe('none');
		expect(base.desktopProfile.realtimeConfig).toEqual(DEFAULT_SETTINGS.desktopProfile.realtimeConfig);
		// realtimeProvider is enum-validated: garbage falls back to the base value
		const bad = mergeSettings(DEFAULT_SETTINGS, {
			// @ts-expect-error deliberately invalid
			desktopProfile: { ...DEFAULT_SETTINGS.desktopProfile, realtimeProvider: 'not-a-provider' },
		});
		expect(bad.desktopProfile.realtimeProvider).toBe('none');
		// a stored partial (e.g. an older data.json with no realtimeConfig) still yields the slot
		const merged = mergeSettings(DEFAULT_SETTINGS, {
			desktopProfile: {
				...DEFAULT_SETTINGS.desktopProfile,
				realtimeConfig: { ...DEFAULT_SETTINGS.desktopProfile.realtimeConfig, model: 'voxtral-mini-transcribe-realtime-2602' },
			},
		});
		expect(merged.desktopProfile.realtimeConfig.model).toBe('voxtral-mini-transcribe-realtime-2602');
	});

	it('keeps valid disabledDefaultTemplateIds and drops malformed entries', () => {
		const merged = mergeSettings(DEFAULT_SETTINGS, {
			// @ts-expect-error deliberately mixed garbage to simulate a corrupt data.json
			disabledDefaultTemplateIds: ['tpl-default-podcast', 42, null, '', 'tpl-default-guides'],
		});
		expect(merged.disabledDefaultTemplateIds).toEqual(['tpl-default-podcast', 'tpl-default-guides']);
	});

	it('falls back to base disabledDefaultTemplateIds when the stored value is not an array', () => {
		const merged = mergeSettings(DEFAULT_SETTINGS, {
			// @ts-expect-error deliberately invalid
			disabledDefaultTemplateIds: 'garbage',
		});
		expect(merged.disabledDefaultTemplateIds).toEqual([]);
	});

	it('sanitizes ingestRules: keeps well-formed rules, drops the rest, coerces enabled to boolean', () => {
		const merged = mergeSettings(DEFAULT_SETTINGS, {
			ingestRules: [
				{ folderPath: 'Voice Inbox', templateId: 'tpl-default-guides', enabled: true },
				// @ts-expect-error non-boolean enabled coerces to false
				{ folderPath: 'Other', templateId: 'tpl', enabled: 'yes' },
				// @ts-expect-error missing templateId is dropped
				{ folderPath: 'NoTemplate' },
				// @ts-expect-error non-object is dropped
				'garbage',
			],
		});
		expect(merged.ingestRules).toEqual([
			{ folderPath: 'Voice Inbox', templateId: 'tpl-default-guides', enabled: true },
			{ folderPath: 'Other', templateId: 'tpl', enabled: false },
		]);
	});

	it('ships the new Phase B whisper defaults off', () => {
		const merged = mergeSettings(DEFAULT_SETTINGS, {});
		expect(merged.localWhisper.autoStart).toBe(false);
		expect(merged.localWhisper.idleStopMinutes).toBe(0);
		expect(merged.recordInBackground).toBe(false);
	});
});
