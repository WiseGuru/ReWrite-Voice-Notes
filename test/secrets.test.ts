import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// secrets.ts keeps module-level caches (the parsed envelope, the unlocked key, the
// secretStorage-availability probe result) that aren't keyed by which fake plugin instance is
// passed in. vi.resetModules() + a fresh dynamic import before each test gives every test a
// clean slate instead of leaking state (or an unlocked key) from a previous test.
let secrets: typeof import('../src/secrets');

class FakeVaultAdapter {
	private files = new Map<string, string>();
	async exists(path: string): Promise<boolean> {
		return this.files.has(path);
	}
	async read(path: string): Promise<string> {
		const v = this.files.get(path);
		if (v === undefined) throw new Error(`ENOENT: ${path}`);
		return v;
	}
	async write(path: string, data: string): Promise<void> {
		this.files.set(path, data);
	}
	async remove(path: string): Promise<void> {
		this.files.delete(path);
	}
	async rename(oldPath: string, newPath: string): Promise<void> {
		const v = this.files.get(oldPath);
		if (v === undefined) throw new Error(`ENOENT: ${oldPath}`);
		this.files.delete(oldPath);
		this.files.set(newPath, v);
	}
	// Test-only helpers, not part of the real Obsidian DataAdapter interface.
	seed(path: string, data: string): void {
		this.files.set(path, data);
	}
	peek(path: string): string | undefined {
		return this.files.get(path);
	}
}

const PLUGIN_DIR = 'rewrite-test-dir';
const SECRETS_PATH = `${PLUGIN_DIR}/secrets.json.nosync`;

function fakePlugin(): { manifest: { id: string; dir: string }; app: { vault: { adapter: FakeVaultAdapter } } } {
	return {
		manifest: { id: 'rewrite-voice-notes', dir: PLUGIN_DIR },
		app: { vault: { adapter: new FakeVaultAdapter() } },
	};
}

// Long enough to clear the zxcvbn MIN_PASSPHRASE_SCORE gate reliably.
const STRONG_PASSPHRASE = 'xqplerith journeys woven sapphire meadow glacier 84213';

beforeEach(async () => {
	vi.resetModules();
	secrets = await import('../src/secrets');
});

describe('passphrase mode round trip', () => {
	it('saves and loads a key after setting a passphrase', async () => {
		const plugin = fakePlugin() as unknown as import('obsidian').Plugin;
		await secrets.setEncryptionMode(plugin, 'passphrase', STRONG_PASSPHRASE);
		await secrets.saveKey(plugin, 'profile-desktop-llm', 'sk-test-key');
		expect(await secrets.loadKey(plugin, 'profile-desktop-llm')).toBe('sk-test-key');
	});

	it('locks and requires the correct passphrase to unlock', async () => {
		const plugin = fakePlugin() as unknown as import('obsidian').Plugin;
		await secrets.setEncryptionMode(plugin, 'passphrase', STRONG_PASSPHRASE);
		await secrets.saveKey(plugin, 'profile-desktop-llm', 'sk-test-key');

		secrets.lockSecrets();
		expect((await secrets.getEncryptionStatus(plugin)).locked).toBe(true);
		// Locked reads degrade to '' rather than throwing.
		expect(await secrets.loadKey(plugin, 'profile-desktop-llm')).toBe('');

		expect(await secrets.unlockSecrets(plugin, 'the wrong passphrase entirely')).toBe(false);
		expect(await secrets.unlockSecrets(plugin, STRONG_PASSPHRASE)).toBe(true);
		expect(await secrets.loadKey(plugin, 'profile-desktop-llm')).toBe('sk-test-key');
	});

	it('deleting a key clears it back to empty', async () => {
		const plugin = fakePlugin() as unknown as import('obsidian').Plugin;
		await secrets.setEncryptionMode(plugin, 'passphrase', STRONG_PASSPHRASE);
		await secrets.saveKey(plugin, 'profile-desktop-llm', 'sk-test-key');
		await secrets.deleteKey(plugin, 'profile-desktop-llm');
		expect(await secrets.loadKey(plugin, 'profile-desktop-llm')).toBe('');
	});
});

describe('corrupt secrets file recovery', () => {
	it('treats invalid JSON as corrupt, preserves it as a .corrupt sidecar, and starts fresh', async () => {
		const plugin = fakePlugin() as unknown as import('obsidian').Plugin;
		const adapter = (plugin as unknown as { app: { vault: { adapter: FakeVaultAdapter } } }).app.vault.adapter;
		const garbage = '{not valid json,,,';
		adapter.seed(SECRETS_PATH, garbage);

		const status = await secrets.getEncryptionStatus(plugin);
		// Falls back to a fresh, unconfigured envelope rather than throwing or silently
		// pretending the (unreadable) file's contents were empty/valid.
		expect(status.mode).toBe('passphrase');
		expect(status.passphraseConfigured).toBe(false);

		// The original corrupt bytes must still be recoverable, not overwritten.
		expect(adapter.peek(`${SECRETS_PATH}.corrupt`)).toBe(garbage);
	});

	it('does not treat a merely-empty (never-configured) file as corrupt', async () => {
		const plugin = fakePlugin() as unknown as import('obsidian').Plugin;
		const adapter = (plugin as unknown as { app: { vault: { adapter: FakeVaultAdapter } } }).app.vault.adapter;
		// A well-formed but unconfigured envelope (no kdf/verifier) is not corruption.
		adapter.seed(SECRETS_PATH, JSON.stringify({ version: 2, mode: 'passphrase', keys: {} }));

		await secrets.getEncryptionStatus(plugin);
		expect(adapter.peek(`${SECRETS_PATH}.corrupt`)).toBeUndefined();
	});
});

afterEach(() => {
	secrets.lockSecrets();
});
