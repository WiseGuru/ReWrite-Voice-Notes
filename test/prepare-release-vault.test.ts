import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import {
	RELEASE_FILES,
	computeTargetPluginDir,
	parseReleaseVaultConfig,
	readPluginId,
} from '../prepare-release-vault.mjs';

describe('RELEASE_FILES', () => {
	it('is exactly the three loose Obsidian assets', () => {
		expect(RELEASE_FILES).toEqual(['main.js', 'manifest.json', 'styles.css']);
	});
});

describe('parseReleaseVaultConfig', () => {
	it('throws when the top-level value is not an object', () => {
		expect(() => parseReleaseVaultConfig(null)).toThrow(/JSON object/);
	});

	it('throws when releaseVault is missing', () => {
		expect(() => parseReleaseVaultConfig({})).toThrow(/releaseVault/);
	});

	it('throws when vaultPath is empty', () => {
		expect(() => parseReleaseVaultConfig({ releaseVault: { vaultPath: '   ' } })).toThrow(/vaultPath/);
	});

	it('returns the trimmed vault path', () => {
		expect(parseReleaseVaultConfig({ releaseVault: { vaultPath: '  /vaults/scratch  ' } })).toEqual({
			vaultPath: '/vaults/scratch',
		});
	});
});

describe('readPluginId', () => {
	it('reads the id from a manifest object', () => {
		expect(readPluginId({ id: 'rewrite-voice-notes' })).toBe('rewrite-voice-notes');
	});

	it('throws when the id is missing', () => {
		expect(() => readPluginId({})).toThrow(/id/);
		expect(() => readPluginId({ id: '  ' })).toThrow(/id/);
	});
});

describe('computeTargetPluginDir', () => {
	it('joins vault path, .obsidian/plugins, and the plugin id', () => {
		expect(computeTargetPluginDir('/vaults/scratch', 'rewrite-voice-notes')).toBe(
			join('/vaults/scratch', '.obsidian', 'plugins', 'rewrite-voice-notes'),
		);
	});
});
