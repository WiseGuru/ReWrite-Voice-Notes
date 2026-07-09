import { App, Notice, Platform, PluginSettingTab, Setting, setIcon } from 'obsidian';
import type ReWritePlugin from '../main';
import {
	ActiveProfileKind,
	ActiveProfileOverride,
	EnvironmentProfile,
	LLMConfig,
	LLMProviderID,
	NewFileCollisionMode,
	RecordingFormatPreference,
	TranscriptionConfig,
	TranscriptionProviderID,
} from '../types';
import { detectActiveProfileKind } from '../platform';
import { createTranscriptionProvider } from '../transcription';
import { transcriptionProviderSupportsRealtime } from '../realtime';
import { createLLMProvider } from '../llm';
import { formatWhisperStatus } from '../whisper-host';
import {
	findTemplateFileById,
	loadPriorTemplateVersions,
	populateDefaultTemplates,
	restoreDefaultTemplate,
	updateDefaultTemplates,
} from '../templates-folder';
import { freshDefaultTemplates } from './default-templates';
import { populateDefaultSharedCore } from '../shared-core';
import { populateDefaultAssistantPrompt } from '../assistant-prompt';
import { populateDefaultKnownNouns } from '../known-nouns';
import {
	changePassphrase,
	clearKeys,
	copyKeys,
	countStoredKeys,
	EncryptionMode,
	EncryptionStatus,
	lockSecrets,
	resetSecrets,
	setEncryptionMode,
	unlockPassphraseStore,
} from '../secrets';
import { hydrateSecrets } from '.';
import { PassphraseModal } from '../ui/passphrase-modal';
import { ConfirmModal } from '../ui/confirm-modal';
import { IngestRuleModal } from '../ui/ingest-rule-modal';

// Sentinel value for the "Custom..." entry in a model dropdown; never written to config.model.
const CUSTOM_MODEL_OPTION = '__rewrite_custom__';

// Base URL of the project wiki. Per-section "Learn more" links point at its
// pages so the in-app docs stay short and the long-form guidance lives in one
// place (the wiki), rather than a help file seeded into the user's vault.
const WIKI_BASE = 'https://github.com/WiseGuru/ReWrite-Voice-Notes/wiki';

// Append an external anchor to the project wiki (a specific page, or the wiki
// root when page is omitted). Opened in a new tab with a safe rel.
function wikiAnchor(parent: HTMLElement, label: string, page = ''): HTMLAnchorElement {
	const href = page ? `${WIKI_BASE}/${page}` : WIKI_BASE;
	const a = parent.createEl('a', { text: label, href });
	a.target = '_blank';
	a.rel = 'noopener noreferrer';
	return a;
}

// A standalone "Learn more" paragraph linking one wiki page, styled like the
// other section descriptions.
function wikiLinkParagraph(parent: HTMLElement, leadText: string, label: string, page: string): void {
	const p = parent.createEl('p', { cls: 'rewrite-section-desc' });
	p.appendText(leadText);
	wikiAnchor(p, label, page);
	p.appendText('.');
}

// Human-readable name for an encryption method, used in the Migrate/Clear copy. Passphrase is
// lowercased mid-sentence and capitalized when it starts a sentence (via the `capitalize` arg).
function modeLabel(mode: EncryptionMode, capitalize = false): string {
	if (mode === 'secretStorage') return 'Obsidian secret storage';
	return capitalize ? 'Passphrase' : 'passphrase';
}

// Probe the locations scripts/build-whisper-linux.sh installs whisper-server to,
// plus the common system/Homebrew paths, and return the first that exists.
// Desktop-only (lazy-requires fs/os via the same window.require pattern as whisper-host.ts);
// returns null on mobile, when require is unavailable, or when nothing is found.
function detectWhisperBinary(): string | null {
	if (!Platform.isDesktop) return null;
	try {
		const req = (window as unknown as { require?: (m: string) => unknown }).require;
		if (typeof req !== 'function') return null;
		const fs = req('fs') as { existsSync(p: string): boolean };
		const os = req('os') as { homedir(): string };
		const path = req('path') as { join(...parts: string[]): string };
		const home = os.homedir();
		const exe = Platform.isWin ? 'whisper-server.exe' : 'whisper-server';
		const candidates = [
			// Build-script defaults: symlink first, then the built binary.
			path.join(home, '.local', 'bin', exe),
			path.join(home, '.local', 'share', 'whisper.cpp', 'build', 'bin', exe),
			// Common system / Homebrew locations.
			path.join('/usr', 'local', 'bin', exe),
			path.join('/opt', 'homebrew', 'bin', exe),
			path.join('/usr', 'bin', exe),
		];
		for (const candidate of candidates) {
			if (fs.existsSync(candidate)) return candidate;
		}
		return null;
	} catch {
		return null;
	}
}

// Cleanup output runs ~256 tokens per minute of speech (≈150 wpm × ~1.3 tokens/word,
// padded ~20% for headings, bullets, and Speaker labels in structured/diarized notes).
// The "Maximum note length" dropdown maps these minute presets onto config.maxTokens;
// the raw token count is editable in Advanced. ~10 min → 2560 is the default.
const TOKENS_PER_MIN = 256;
const NOTE_LENGTH_PRESETS: Array<{ minutes: number; tokens: number }> = [
	{ minutes: 5, tokens: 1280 },
	{ minutes: 10, tokens: 2560 },
	{ minutes: 20, tokens: 5120 },
	{ minutes: 30, tokens: 7680 },
	{ minutes: 60, tokens: 15360 },
];

const TRANSCRIPTION_OPTIONS: Array<{ id: TranscriptionProviderID; label: string; desktopOnly?: boolean }> = [
	{ id: 'openai', label: 'OpenAI Whisper' },
	{ id: 'openai-compatible', label: 'OpenAI-compatible (local server)' },
	{ id: 'groq', label: 'Groq' },
	{ id: 'assemblyai', label: 'AssemblyAI' },
	{ id: 'deepgram', label: 'Deepgram' },
	{ id: 'revai', label: 'Rev.ai' },
	{ id: 'mistral-voxtral', label: 'Mistral Voxtral' },
	{ id: 'whisper-local', label: 'Local whisper.cpp (desktop only)', desktopOnly: true },
	{ id: 'none', label: 'None (text-only; recording disabled)' },
];

const LLM_OPTIONS: Array<{ id: LLMProviderID; label: string }> = [
	{ id: 'anthropic', label: 'Anthropic Claude' },
	{ id: 'openai', label: 'OpenAI GPT' },
	{ id: 'openai-compatible', label: 'OpenAI-compatible (cloud or local)' },
	{ id: 'gemini', label: 'Google Gemini' },
	{ id: 'mistral', label: 'Mistral' },
	{ id: 'none', label: 'None (skip cleanup; insert raw text)' },
];

const RECORDING_FORMAT_OPTIONS: Array<{ id: RecordingFormatPreference; label: string }> = [
	{ id: 'webm', label: 'webm (best on Chromium/Electron)' },
	{ id: 'mp4', label: 'mp4 (best on mobile/Safari)' },
];

export class ReWriteSettingTab extends PluginSettingTab {
	// Tracks whether the inactive-on-this-device profile is expanded. Survives
	// the full-container redraws that fire when dropdowns toggle conditional
	// fields (provider, insertMode, activeProfileOverride).
	private inactiveProfileExpanded = false;

	// Guards the encryption-mode dropdown against a second change racing the first
	// while its async re-encryption + re-render is still in flight.
	private modeChangeInFlight = false;

	// Expand state of the "Manage built-in templates" disclosure, surviving the
	// full-container redraws its own toggles trigger (mirrors inactiveProfileExpanded).
	private manageDefaultsExpanded = false;

	constructor(app: App, private readonly plugin: ReWritePlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass('rewrite-settings');

		const intro = containerEl.createEl('p', { cls: 'rewrite-section-desc' });
		intro.appendText('New to ReWrite? See the ');
		wikiAnchor(intro, 'Quick start', 'Quick-Start');
		intro.appendText(', or browse the full ');
		wikiAnchor(intro, 'documentation wiki', '');
		intro.appendText('.');

		this.renderEncryption(containerEl);
		this.renderActiveProfile(containerEl);
		this.renderProfile(containerEl, 'desktop');
		this.renderProfile(containerEl, 'mobile');
		this.renderLocalWhisperServer(containerEl);
		this.renderTemplates(containerEl);
		this.renderSharedCore(containerEl);
		this.renderRecording(containerEl);
		this.renderAutoIngest(containerEl);
		this.renderAdHocInstructions(containerEl);
		this.renderKnownNouns(containerEl);
	}

	// Central save chokepoint for every settings field's onChange. Fields call this without
	// awaiting or catching (Obsidian's Setting components fire-and-forget the async handler),
	// so a save failure (e.g. the OS keyring becoming unavailable mid-session while writing an
	// API key) would otherwise be an unhandled rejection with zero user-visible feedback.
	private async commit(): Promise<void> {
		try {
			await this.plugin.saveSettings();
		} catch (e) {
			console.error('ReWrite: failed to save settings', e);
			new Notice(`ReWrite: could not save settings — ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	// Builds a section heading with a Lucide icon prepended to its label. Returns the
	// Setting so callers can still reach nameEl (e.g. to attach a status badge).
	private sectionHeading(parent: HTMLElement, name: string, icon: string): Setting {
		const setting = new Setting(parent).setName(name).setHeading();
		const iconEl = setting.nameEl.createSpan({ cls: 'rewrite-heading-icon' });
		setIcon(iconEl, icon);
		setting.nameEl.prepend(iconEl);
		return setting;
	}

	// Disables a settings button for the duration of its async handler so a rapid
	// double-click cannot launch the work (and its full-container re-render) twice
	// before the first invocation yields. The handler keeps its own try/catch; this
	// only owns the in-flight guard, re-enabling in `finally` (harmless when the
	// handler ended in `this.display()` and detached the button).
	private async runGuardedButton(b: { setDisabled(disabled: boolean): unknown }, fn: () => Promise<void>): Promise<void> {
		b.setDisabled(true);
		try {
			await fn();
		} finally {
			b.setDisabled(false);
		}
	}

	private apiKeyPlaceholder(): string {
		const status = this.plugin.encryptionStatus;
		if (status.locked) {
			return status.configured ? 'Locked. Unlock to view or edit.' : 'Set a passphrase to store keys.';
		}
		return 'Saved securely on this device';
	}

	private applyApiKeyFieldState(input: HTMLInputElement): void {
		if (this.plugin.encryptionStatus.locked) {
			input.disabled = true;
		}
	}

	private renderEncryption(parent: HTMLElement): void {
		const status = this.plugin.encryptionStatus;

		const banner = parent.createDiv({ cls: 'rewrite-encryption-banner' });
		if (status.mode === 'passphrase' && !status.configured) {
			banner.addClass('is-warning');
			banner.createEl('strong', { text: 'No encryption set.' });
			banner.createEl('span', {
				text: ' Set a passphrase to encrypt your API keys on this device. Until then, recording and processing are disabled.',
			});
			const setBtn = banner.createEl('button', { text: 'Set passphrase', cls: 'mod-cta' });
			setBtn.addEventListener('click', () => {
				this.plugin.promptUnlock(() => this.display());
			});
		} else if (status.locked) {
			banner.addClass('is-locked');
			banner.createEl('strong', { text: 'API keys are locked.' });
			banner.createEl('span', {
				text: ' Enter your passphrase to decrypt them. Until then, recording and processing are disabled.',
			});
			const unlockBtn = banner.createEl('button', { text: 'Unlock', cls: 'mod-cta' });
			unlockBtn.addEventListener('click', () => {
				this.plugin.promptUnlock(() => this.display());
			});
			const resetBtn = banner.createEl('button', { text: 'Forgot passphrase? Reset', cls: 'mod-warning' });
			resetBtn.addEventListener('click', () => this.openResetModal());
		} else if (status.mode === 'secretStorage') {
			banner.addClass('is-ok');
			banner.createEl('span', {
				text: 'Encrypted via Obsidian secret storage. If you use Obsidian Sync, these keys may sync across your devices.',
			});
		} else if (status.mode === 'passphrase') {
			banner.addClass('is-ok');
			banner.createEl('span', { text: 'Encrypted with passphrase. Unlocked for this session.' });
		}

		if (!status.secretStorageAvailable) {
			const note = parent.createDiv({ cls: 'rewrite-encryption-banner is-warning' });
			note.createEl('strong', { text: 'Obsidian secret storage unavailable.' });
			note.createEl('span', {
				text: ' This device has no working OS secret store, or Obsidian is older than 1.11.4, so only the passphrase option is offered. Update Obsidian to use the OS-backed option.',
			});
		}

		this.sectionHeading(parent, 'API key encryption', 'lock');

		parent.createEl('p', {
			text: 'Your API keys are saved in a file named secrets.json.nosync in the plugin folder. This setting picks how that file is locked.',
			cls: 'rewrite-section-desc',
		});
		wikiLinkParagraph(parent, 'How keys are encrypted and how to keep the key file off device sync: ', 'Secrets and sync', 'Secrets-and-Sync');

		new Setting(parent)
			.setName('Encryption mode')
			.setDesc(this.encryptionModeDescription(status))
			.addDropdown((dd) => {
				if (status.secretStorageAvailable || status.mode === 'secretStorage') {
					dd.addOption('secretStorage', 'Obsidian secret storage (recommended)');
				}
				dd.addOption('passphrase', 'Passphrase (cross-platform)');
				dd.setValue(status.mode);
				dd.onChange((v) => {
					const next = v as EncryptionMode;
					if (next === status.mode) return;
					void this.handleSwitchMode(next);
				});
			});

		// Switching the mode above does NOT move keys. Copy (duplicate other -> active) and Clear
		// (wipe a method) are explicit, separate actions, rendered into this container once their
		// async key counts resolve. Gated on an unlocked active store: a locked or unconfigured
		// passphrase is handled by the banner's Unlock / Set passphrase button instead.
		if (!status.locked) {
			const transferEl = parent.createDiv();
			void this.renderKeyTransferControls(transferEl, status);
		}

		if (status.mode === 'passphrase' && !status.locked) {
			new Setting(parent)
				.setName('Change passphrase')
				.setDesc('Re-encrypts all stored keys with a new passphrase.')
				.addButton((b) => {
					b.setButtonText('Change').onClick(() => {
						new PassphraseModal({
							app: this.app,
							title: 'Set a new passphrase',
							description: 'Replaces the current passphrase. Stored API keys will be re-encrypted.',
							confirmLabel: 'Save',
							requireConfirm: true,
							enforceStrength: true,
							onSubmit: async (pass) => {
								await changePassphrase(this.plugin, pass);
								await this.plugin.refreshEncryptionStatus();
								new Notice('ReWrite: passphrase updated.');
								this.display();
							},
						}).open();
					});
				});

			new Setting(parent)
				.setName('Lock now')
				.setDesc('Forgets the passphrase in memory. You will need to re-enter it before recording.')
				.addButton((b) => {
					b.setButtonText('Lock').onClick(() => void this.runGuardedButton(b, async () => {
						lockSecrets();
						await hydrateSecrets(this.plugin, this.plugin.settings);
						await this.plugin.refreshEncryptionStatus();
						this.display();
					}));
				});
		}
	}

	// Render the Migrate and Clear rows once the per-method key counts resolve. Appended async
	// because display() is synchronous; the rows pop into `parent` a tick later.
	private async renderKeyTransferControls(parent: HTMLElement, status: EncryptionStatus): Promise<void> {
		const active = status.mode;
		const other: EncryptionMode = active === 'secretStorage' ? 'passphrase' : 'secretStorage';
		const [activeCount, otherCount] = await Promise.all([
			countStoredKeys(this.plugin, active),
			countStoredKeys(this.plugin, other),
		]);

		if (activeCount === 0 && otherCount > 0) {
			const hint = parent.createDiv({ cls: 'rewrite-encryption-banner is-warning' });
			hint.createEl('span', {
				text: `${modeLabel(active, true)} has no saved keys yet. Use the Copy button to bring your ${otherCount} key(s) over from ${modeLabel(other)}, or enter them above.`,
			});
		}

		if (otherCount > 0) {
			new Setting(parent)
				.setName(`Copy keys from ${modeLabel(other)}`)
				.setDesc(`Copies your ${otherCount} saved key(s) from ${modeLabel(other)} into ${modeLabel(active)}. The originals are kept; use Clear to remove them.`)
				.addButton((b) => {
					b.setButtonText('Copy').onClick(() => void this.handleCopy());
				});
		}

		if (activeCount > 0) {
			new Setting(parent)
				.setName(`Clear keys in ${modeLabel(active)}`)
				.setDesc(`Permanently deletes the ${activeCount} key(s) saved under ${modeLabel(active)}. This cannot be undone.`)
				.addButton((b) => {
					b.setButtonText('Clear').setWarning().onClick(() => this.handleClear(active, activeCount));
				});
		}
	}

	// Switch the ACTIVE encryption method without moving any keys (Migrate does that). Switching to
	// an unconfigured passphrase store prompts for a new passphrase; switching to an already
	// configured one just activates it (locked until the user unlocks).
	private async handleSwitchMode(next: EncryptionMode): Promise<void> {
		if (this.modeChangeInFlight) return;
		this.modeChangeInFlight = true;
		try {
			if (next === 'passphrase' && !this.plugin.encryptionStatus.passphraseConfigured) {
				new PassphraseModal({
					app: this.app,
					title: 'Set a passphrase',
					description: 'A passphrase will encrypt your API keys. Store it in your password manager; there is no recovery if you forget it. This does not move keys saved under Obsidian secret storage; use Copy for that.',
					confirmLabel: 'Save',
					requireConfirm: true,
					enforceStrength: true,
					onSubmit: async (pass) => {
						await setEncryptionMode(this.plugin, 'passphrase', pass);
						await hydrateSecrets(this.plugin, this.plugin.settings);
						await this.plugin.refreshEncryptionStatus();
						this.plugin.notifySecretsUnlocked();
						new Notice('ReWrite: passphrase encryption enabled.');
						this.display();
					},
				}).open();
				// Re-render now so the dropdown reverts to the current mode until the user confirms.
				this.display();
				return;
			}
			await setEncryptionMode(this.plugin, next);
			await hydrateSecrets(this.plugin, this.plugin.settings);
			await this.plugin.refreshEncryptionStatus();
			new Notice(`ReWrite: switched to ${modeLabel(next)}.`);
			this.display();
		} catch (e) {
			console.error('ReWrite: encryption mode switch failed', e);
			new Notice(`ReWrite: ${e instanceof Error ? e.message : String(e)}`);
			await this.plugin.refreshEncryptionStatus();
			this.display();
		} finally {
			this.modeChangeInFlight = false;
		}
	}

	// Copy keys from the inactive method into the active method. When the source is the passphrase
	// store it must be unlocked first (it may be locked while secretStorage is active), so prompt
	// for the passphrase before the confirm. The source is never deleted; Clear does that.
	private async handleCopy(): Promise<void> {
		const status = this.plugin.encryptionStatus;
		const active = status.mode;
		const other: EncryptionMode = active === 'secretStorage' ? 'passphrase' : 'secretStorage';
		const sourceCount = await countStoredKeys(this.plugin, other);
		if (sourceCount === 0) {
			new Notice('ReWrite: no keys to copy.');
			return;
		}

		const confirmCopy = (): void => {
			new ConfirmModal({
				app: this.app,
				title: 'Copy API keys',
				body: `Copy ${sourceCount} key(s) from ${modeLabel(other)} into ${modeLabel(active)}? Existing keys with the same name in ${modeLabel(active)} are overwritten. The ${modeLabel(other)} copy is kept (use Clear to remove it).`,
				confirmLabel: 'Copy',
				onConfirm: async () => {
					const n = await copyKeys(this.plugin);
					await hydrateSecrets(this.plugin, this.plugin.settings);
					await this.plugin.refreshEncryptionStatus();
					new Notice(`ReWrite: copied ${n} key(s) into ${modeLabel(active)}.`);
					this.display();
				},
			}).open();
		};

		// Copying FROM the passphrase store needs its derived key in memory to decrypt the source.
		if (other === 'passphrase') {
			new PassphraseModal({
				app: this.app,
				title: 'Unlock passphrase store',
				description: 'Enter the passphrase that encrypts the keys you want to copy.',
				confirmLabel: 'Unlock',
				onSubmit: async (pass) => {
					const ok = await unlockPassphraseStore(this.plugin, pass);
					if (!ok) throw new Error('Incorrect passphrase.');
					confirmCopy();
				},
			}).open();
			return;
		}
		confirmCopy();
	}

	// Permanently wipe the keys saved under one method. Destructive, so behind a confirm.
	private handleClear(mode: EncryptionMode, count: number): void {
		const extra = mode === 'passphrase'
			? ' You will need to set a passphrase again before storing keys under it.'
			: '';
		new ConfirmModal({
			app: this.app,
			title: 'Clear saved API keys',
			body: `Permanently delete the ${count} API key(s) saved under ${modeLabel(mode)}? This cannot be undone.${extra}`,
			confirmLabel: 'Delete keys',
			confirmCls: 'mod-warning',
			onConfirm: async () => {
				await clearKeys(this.plugin, mode);
				await hydrateSecrets(this.plugin, this.plugin.settings);
				await this.plugin.refreshEncryptionStatus();
				new Notice(`ReWrite: cleared ${count} key(s) from ${modeLabel(mode)}.`);
				this.display();
			},
		}).open();
	}

	private openResetModal(): void {
		new PassphraseModal({
			app: this.app,
			title: 'Reset API key passphrase',
			description: 'Forgot your passphrase? This permanently deletes every stored API key and sets a new passphrase. The old keys cannot be recovered; you will re-enter each API key afterward.',
			confirmLabel: 'Delete keys and set passphrase',
			requirePhrase: 'DELETE APIS',
			requireConfirm: true,
			enforceStrength: true,
			onSubmit: async (pass) => {
				await resetSecrets(this.plugin, pass);
				// Old in-memory keys are gone; re-hydrate to empty them so a later save
				// cannot rewrite stale values, then refresh status and re-render.
				await hydrateSecrets(this.plugin, this.plugin.settings);
				await this.plugin.refreshEncryptionStatus();
				this.plugin.notifySecretsUnlocked();
				new Notice('ReWrite: API keys cleared. New passphrase set.');
				this.display();
			},
		}).open();
	}

	private encryptionModeDescription(status: { mode: EncryptionMode; secretStorageAvailable: boolean }): string {
		const lines: string[] = [];
		if (status.secretStorageAvailable) {
			lines.push('Obsidian secret storage: encrypted at rest by your operating system and managed by Obsidian. Shared with other plugins and, if you use Obsidian Sync, may sync your keys across devices. Recommended.');
		} else {
			lines.push('Obsidian secret storage: not available on this device (needs Obsidian 1.11.4+ and a working OS secret store).');
		}
		lines.push('Passphrase: AES-GCM with an Argon2id-derived key (PBKDF2 fallback on devices that cannot run Argon2id). You enter a passphrase once per session, and the keys stay on this device. Works on every platform, including mobile.');
		return lines.join(' ');
	}

	private renderActiveProfile(parent: HTMLElement): void {
		this.sectionHeading(parent, 'Active profile', 'user');
		const s = this.plugin.settings;
		const detected = detectActiveProfileKind(s);
		const detectedLabel = detected === 'desktop' ? 'Desktop' : 'Mobile';
		const overrideDesc = s.activeProfileOverride === 'auto'
			? `Auto-detected: ${detectedLabel}.`
			: `Forced: ${detectedLabel}.`;

		new Setting(parent)
			.setName('Profile selection')
			.setDesc(overrideDesc)
			.addDropdown((dd) => {
				dd.addOption('auto', 'Auto-detect (recommended)');
				dd.addOption('desktop', 'Force desktop');
				dd.addOption('mobile', 'Force mobile');
				dd.setValue(s.activeProfileOverride);
				dd.onChange(async (v) => {
					s.activeProfileOverride = v as ActiveProfileOverride;
					await this.commit();
					this.display();
				});
			});
	}

	private renderProfile(parent: HTMLElement, kind: ActiveProfileKind): void {
		const profile = kind === 'desktop'
			? this.plugin.settings.desktopProfile
			: this.plugin.settings.mobileProfile;
		const title = kind === 'desktop' ? 'Desktop profile' : 'Mobile profile';
		const isActive = detectActiveProfileKind(this.plugin.settings) === kind;

		const section = parent.createDiv({ cls: 'rewrite-profile-section' });
		if (isActive) section.addClass('is-active-profile');

		const heading = this.sectionHeading(section, title, kind === 'desktop' ? 'monitor' : 'smartphone');
		if (isActive) {
			heading.nameEl.createSpan({
				cls: 'rewrite-profile-active-badge',
				text: 'Active on this device',
			});
		}

		let body: HTMLElement;
		if (isActive) {
			body = section;
		} else {
			const details = section.createEl('details', { cls: 'rewrite-profile-collapsed' });
			details.open = this.inactiveProfileExpanded;
			details.addEventListener('toggle', () => {
				this.inactiveProfileExpanded = details.open;
			});
			details.createEl('summary', { text: 'Show settings' });
			body = details;
		}

		wikiLinkParagraph(body, 'Choosing transcription and LLM providers, models, and base URLs: ', 'Providers', 'Providers');

		new Setting(body)
			.setName('Profile label')
			.setDesc('Display name for this profile.')
			.addText((t) => {
				t.setValue(profile.name);
				t.onChange(async (v) => {
					profile.name = v;
					await this.commit();
				});
			});

		// The three provider subsections (batch transcription, real-time, LLM) each carry a
		// heading and share one field order: provider, base URL (where applicable), API key,
		// then model. Keeping the arrangement identical lets the profile scan predictably.
		new Setting(body).setName('Transcription').setHeading();

		new Setting(body)
			.setName('Transcription provider')
			.addDropdown((dd) => {
				for (const opt of TRANSCRIPTION_OPTIONS) {
					if (opt.desktopOnly && !Platform.isDesktop) continue;
					dd.addOption(opt.id, opt.label);
				}
				dd.setValue(profile.transcriptionProvider);
				dd.onChange(async (v) => {
					profile.transcriptionProvider = v as TranscriptionProviderID;
					await this.commit();
					this.display();
				});
			});

		if (profile.transcriptionProvider !== 'none') {
			if (profile.transcriptionProvider === 'openai-compatible') {
				new Setting(body)
					.setName('Transcription base URL')
					.setDesc('e.g. http://localhost:8080 (whisper.cpp, faster-whisper-server)')
					.addText((t) => {
						t.setValue(profile.transcriptionConfig.baseUrl);
						t.onChange(async (v) => {
							profile.transcriptionConfig.baseUrl = v;
							await this.commit();
						});
					});
			}

			if (profile.transcriptionProvider !== 'whisper-local') {
				new Setting(body)
					.setName('Transcription API key')
					.addText((t) => {
						t.inputEl.type = 'password';
						this.applyApiKeyFieldState(t.inputEl);
						t.setPlaceholder(this.apiKeyPlaceholder());
						t.setValue(profile.transcriptionConfig.apiKey);
						t.onChange(async (v) => {
							if (this.plugin.encryptionStatus.locked) return;
							profile.transcriptionConfig.apiKey = v;
							await this.commit();
						});
					});
			}

			this.renderTranscriptionModelField(body, profile);
		}

		// Real-time (streaming) transcription is configured entirely on its own: its own
		// provider, key, and model, independent of the batch transcription provider above.
		// So a profile can use one service for batch and a different one for live dictation.
		this.renderRealtimeSection(body, profile);

		new Setting(body).setName('Post-processing (LLM)').setHeading();

		new Setting(body)
			.setName('LLM provider')
			.addDropdown((dd) => {
				for (const opt of LLM_OPTIONS) dd.addOption(opt.id, opt.label);
				dd.setValue(profile.llmProvider);
				dd.onChange(async (v) => {
					profile.llmProvider = v as LLMProviderID;
					await this.commit();
					this.display();
				});
			});

		if (profile.llmProvider !== 'none') {
			if (profile.llmProvider === 'openai-compatible') {
				new Setting(body)
					.setName('LLM base URL')
					.setDesc('e.g. https://api.deepseek.com/v1 (cloud) or http://localhost:11434/v1 (Ollama). See README for more OpenAI-compatible providers.')
					.addText((t) => {
						t.setValue(profile.llmConfig.baseUrl);
						t.onChange(async (v) => {
							profile.llmConfig.baseUrl = v;
							await this.commit();
						});
					});
			}

			new Setting(body)
				.setName('LLM API key')
				.addText((t) => {
					t.inputEl.type = 'password';
					this.applyApiKeyFieldState(t.inputEl);
					t.setPlaceholder(this.apiKeyPlaceholder());
					t.setValue(profile.llmConfig.apiKey);
					t.onChange(async (v) => {
						if (this.plugin.encryptionStatus.locked) return;
						profile.llmConfig.apiKey = v;
						await this.commit();
					});
				});

			this.renderLLMModelField(body, profile);

			this.renderNoteLength(body, profile);
		}

		this.renderProfileAdvanced(body, profile);
	}

	// Normal-area control for cleanup output length, framed in minutes rather than raw
	// tokens. Presets map onto config.maxTokens (the single source of truth); a non-preset
	// value (set via the Advanced "LLM max tokens" field) surfaces as a "Custom (...)" option.
	private renderNoteLength(parent: HTMLElement, profile: EnvironmentProfile): void {
		const current = profile.llmConfig.maxTokens;
		const matched = NOTE_LENGTH_PRESETS.some((p) => p.tokens === current);

		const setting = new Setting(parent)
			.setName('Maximum note length')
			.setDesc(
				'How long a recording the cleaned note can hold before the response is cut off. ' +
					'Roughly 10 min of speech ≈ 2,560 tokens; structured or multi-speaker notes run longer. ' +
					'For an exact token count, use LLM max tokens under Advanced.',
			)
			.addDropdown((d) => {
				for (const p of NOTE_LENGTH_PRESETS) {
					d.addOption(String(p.tokens), `~${p.minutes} min (${p.tokens.toLocaleString()} tokens)`);
				}
				if (!matched) {
					const mins = Math.max(1, Math.round(current / TOKENS_PER_MIN));
					d.addOption(String(current), `Custom (${current.toLocaleString()} tokens, ~${mins} min)`);
				}
				d.setValue(String(current));
				d.onChange(async (v) => {
					const n = Number.parseInt(v, 10);
					if (!Number.isFinite(n) || n <= 0) return;
					profile.llmConfig.maxTokens = n;
					await this.commit();
					// Re-render so the Advanced raw-token field reflects the new value.
					this.display();
				});
			});
		setting.settingEl.addClass('rewrite-note-length');
	}

	// Real-time (streaming) transcription, configured independently of batch transcription:
	// its own provider dropdown (None + realtime-capable providers only), key, and model.
	private renderRealtimeSection(parent: HTMLElement, profile: EnvironmentProfile): void {
		new Setting(parent).setName('Real-time transcription').setHeading();
		new Setting(parent)
			.setName('Real-time provider')
			.setDesc('Provider for live dictation, independent of the batch transcription provider above. Only providers with a streaming endpoint are listed.')
			.addDropdown((dd) => {
				for (const opt of TRANSCRIPTION_OPTIONS) {
					if (opt.desktopOnly && !Platform.isDesktop) continue;
					// 'none' (off) plus only the realtime-capable providers.
					if (opt.id !== 'none' && !transcriptionProviderSupportsRealtime(opt.id)) continue;
					dd.addOption(opt.id, opt.label);
				}
				dd.setValue(transcriptionProviderSupportsRealtime(profile.realtimeProvider) ? profile.realtimeProvider : 'none');
				dd.onChange(async (v) => {
					profile.realtimeProvider = v as TranscriptionProviderID;
					await this.commit();
					this.display();
				});
			});

		if (!transcriptionProviderSupportsRealtime(profile.realtimeProvider)) return;

		new Setting(parent)
			.setName('Real-time API key')
			.setDesc('Key for the real-time provider. Stored encrypted.')
			.addText((t) => {
				t.inputEl.type = 'password';
				this.applyApiKeyFieldState(t.inputEl);
				t.setPlaceholder(this.apiKeyPlaceholder());
				t.setValue(profile.realtimeConfig.apiKey);
				t.onChange(async (v) => {
					if (this.plugin.encryptionStatus.locked) return;
					profile.realtimeConfig.apiKey = v;
					await this.commit();
				});
			});
		// Adaptive model control (dropdown + Refresh where the provider lists models, else a
		// text field), sharing populateModelField with the batch fields. The streaming model
		// is often different from the batch model, so it has its own value in realtimeConfig.
		parent.createEl('p', {
			text: 'The streaming model, often different from the batch model. Leave blank for the provider default.',
			cls: 'rewrite-section-desc',
		});
		const modelWrapper = parent.createDiv({ cls: 'rewrite-model-field' });
		this.populateModelField(modelWrapper, profile, 'realtime');
	}

	private renderProfileAdvanced(parent: HTMLElement, profile: EnvironmentProfile): void {
		if (profile.transcriptionProvider === 'none' && profile.llmProvider === 'none') return;

		const details = parent.createEl('details', { cls: 'rewrite-advanced' });
		details.createEl('summary', { text: 'Advanced' });

		if (profile.transcriptionProvider !== 'none') {
			new Setting(details)
				.setName('Transcription language')
				.setDesc('Optional language hint. Leave blank to auto-detect.')
				.addText((t) => {
					t.setValue(profile.transcriptionConfig.language);
					t.onChange(async (v) => {
						profile.transcriptionConfig.language = v;
						await this.commit();
					});
				});
		}

		if (profile.llmProvider !== 'none') {
			new Setting(details)
				.setName('LLM max tokens')
				.setDesc(
					'Exact token cap for the cleanup response, overriding the Maximum note length presets. ' +
						'~256 tokens ≈ 1 min of cleaned speech. Default 2560.',
				)
				.addText((t) => {
					t.inputEl.type = 'number';
					t.setValue(String(profile.llmConfig.maxTokens));
					t.onChange(async (v) => {
						const n = Number.parseInt(v, 10);
						profile.llmConfig.maxTokens = Number.isFinite(n) && n > 0 ? n : 2560;
						await this.commit();
					});
				});
		}
	}

	private renderTranscriptionModelField(parent: HTMLElement, profile: EnvironmentProfile): void {
		const wrapper = parent.createDiv({ cls: 'rewrite-model-field' });
		this.populateModelField(wrapper, profile, 'transcription');
	}

	private renderLLMModelField(parent: HTMLElement, profile: EnvironmentProfile): void {
		const wrapper = parent.createDiv({ cls: 'rewrite-model-field' });
		this.populateModelField(wrapper, profile, 'llm');
	}

	/**
	 * Renders a single adaptive model control: a dropdown when the provider supports
	 * listModels and the cache holds models, otherwise a plain text field. The dropdown
	 * carries a "Custom..." escape hatch that toggles the same control into the text field
	 * (forceText) so a model not in the catalog can still be typed. The canonical value is
	 * always config.model; the dropdown and text field both write straight into it.
	 */
	private populateModelField(
		wrapper: HTMLElement,
		profile: EnvironmentProfile,
		side: 'transcription' | 'llm' | 'realtime',
		forceText = false,
	): void {
		wrapper.empty();

		// 'transcription' and 'realtime' are both backed by a transcription provider; they
		// differ only in which provider id / config slot / model cache they read (realtime
		// shares the transcription cache since it is the same provider's catalogue). 'llm'
		// uses the LLM provider + cache.
		const isLLM = side === 'llm';
		const transcriptionId = side === 'realtime' ? profile.realtimeProvider : profile.transcriptionProvider;
		const provider = isLLM
			? createLLMProvider(profile.llmProvider)
			: createTranscriptionProvider(transcriptionId);
		const config: TranscriptionConfig | LLMConfig = side === 'transcription'
			? profile.transcriptionConfig
			: side === 'realtime'
				? profile.realtimeConfig
				: profile.llmConfig;
		const cached = (isLLM
			? this.plugin.settings.modelCache.llm[profile.llmProvider]
			: this.plugin.settings.modelCache.transcription[transcriptionId])?.ids ?? [];
		const hint = isLLM
			? llmModelHint(profile.llmProvider)
			: transcriptionModelHint(transcriptionId);
		const current = config.model;
		const supportsList = typeof provider.listModels === 'function';
		const showDropdown = supportsList && cached.length > 0 && !forceText;

		const mode: ModelFieldMode = !supportsList
			? 'plain'
			: forceText
				? 'custom'
				: cached.length === 0
					? 'empty-cache'
					: 'dropdown';

		const docsUrl = isLLM ? null : transcriptionModelDocsUrl(transcriptionId);

		const label = side === 'transcription'
			? 'Transcription model'
			: side === 'realtime'
				? 'Real-time model'
				: 'LLM model';
		const setting = new Setting(wrapper).setName(label);
		applyModelFieldDesc(setting, hint, mode, docsUrl);

		const refresh = async (): Promise<void> => {
			if (isLLM) {
				await this.refreshLLMModels(profile.llmProvider, profile.llmConfig);
			} else {
				await this.refreshTranscriptionModels(transcriptionId, config as TranscriptionConfig);
			}
			this.populateModelField(wrapper, profile, side, false);
		};

		if (showDropdown) {
			setting.addDropdown((dd) => {
				if (!current) dd.addOption('', '(pick a model)');
				for (const id of cached) dd.addOption(id, id);
				if (current && !cached.includes(current)) dd.addOption(current, `${current} (custom)`);
				dd.addOption(CUSTOM_MODEL_OPTION, 'Custom...');
				dd.setValue(current || '');
				dd.onChange(async (v) => {
					if (v === CUSTOM_MODEL_OPTION) {
						this.populateModelField(wrapper, profile, side, true);
						return;
					}
					config.model = v;
					await this.commit();
					this.populateModelField(wrapper, profile, side, false);
				});
			});
			setting.addExtraButton((b) => {
				b.setIcon('refresh-cw').setTooltip('Refresh model list').onClick(() => void refresh());
			});
			return;
		}

		setting.addText((t) => {
			t.setValue(current);
			t.setPlaceholder(hint);
			t.onChange(async (v) => {
				config.model = v;
				await this.commit();
			});
		});

		if (forceText && cached.length > 0) {
			setting.addExtraButton((b) => {
				b.setIcon('list').setTooltip('Back to list').onClick(() => {
					this.populateModelField(wrapper, profile, side, false);
				});
			});
		} else if (supportsList) {
			setting.addExtraButton((b) => {
				b.setIcon('refresh-cw').setTooltip('Refresh model list').onClick(() => void refresh());
			});
		}
	}

	private async refreshTranscriptionModels(
		providerId: TranscriptionProviderID,
		config: TranscriptionConfig,
	): Promise<void> {
		const provider = createTranscriptionProvider(providerId);
		if (!provider.listModels) return;
		try {
			const ids = await provider.listModels(config);
			this.plugin.settings.modelCache.transcription[providerId] = { ids, fetchedAt: Date.now() };
			await this.commit();
			new Notice(`ReWrite: refreshed ${ids.length} ${providerId} models.`);
		} catch (e) {
			new Notice(`ReWrite: refresh failed. ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	private async refreshLLMModels(
		providerId: LLMProviderID,
		config: LLMConfig,
	): Promise<void> {
		const provider = createLLMProvider(providerId);
		if (!provider.listModels) return;
		try {
			const ids = await provider.listModels(config);
			this.plugin.settings.modelCache.llm[providerId] = { ids, fetchedAt: Date.now() };
			await this.commit();
			new Notice(`ReWrite: refreshed ${ids.length} ${providerId} models.`);
		} catch (e) {
			new Notice(`ReWrite: refresh failed. ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	private renderLocalWhisperServer(parent: HTMLElement): void {
		if (!Platform.isDesktop) return;

		this.sectionHeading(parent, 'Local whisper.cpp server (desktop)', 'server');
		parent.createEl('p', {
			text: 'Run your own whisper-server program so your speech stays on this computer. The plugin only uses the file paths you give it. It never downloads or looks for programs on its own.',
			cls: 'rewrite-section-desc',
		});
		wikiLinkParagraph(parent, 'Getting a binary, building it, the FUTO models, and troubleshooting: ', 'Self-hosting: whisper.cpp', 'Self-Hosting-Whisper');

		const cfg = this.plugin.settings.localWhisper;

		new Setting(parent)
			.setName('Binary path')
			.setDesc('Absolute path to whisper-server (or whisper-server.exe on Windows). The Linux build script (scripts/build-whisper-linux.sh) installs it to ~/.local/bin/whisper-server by default; use Auto-detect to fill this in.')
			.addText((t) => {
				t.setValue(cfg.binaryPath);
				t.setPlaceholder('~/.local/bin/whisper-server');
				t.onChange(async (v) => {
					cfg.binaryPath = v;
					await this.commit();
				});
			})
			.addExtraButton((b) => {
				b.setIcon('search').setTooltip('Look for whisper-server in the build script\'s install locations').onClick(() => void this.runGuardedButton(b, async () => {
					const found = detectWhisperBinary();
					if (found) {
						cfg.binaryPath = found;
						await this.commit();
						new Notice(`ReWrite: found whisper-server at ${found}`);
						this.display();
					} else {
						new Notice('ReWrite: no whisper-server found in the usual install locations. Set the path manually.');
					}
				}));
			});

		new Setting(parent)
			.setName('Model path')
			.setDesc('Absolute path to a GGML/GGUF model file (e.g. ggml-base.en.bin).')
			.addText((t) => {
				t.setValue(cfg.modelPath);
				t.setPlaceholder('/path/to/ggml-base.en.bin');
				t.onChange(async (v) => {
					cfg.modelPath = v;
					await this.commit();
				});
			});

		new Setting(parent)
			.setName('Port')
			.setDesc('Loopback port the server listens on. Default 8080.')
			.addText((t) => {
				t.inputEl.type = 'number';
				t.setValue(String(cfg.port));
				t.onChange(async (v) => {
					const n = Number.parseInt(v, 10);
					cfg.port = Number.isFinite(n) && n > 0 ? n : 8080;
					await this.commit();
				});
			});

		new Setting(parent)
			.setName('Extra args')
			.setDesc('Space-separated CLI args appended after -m, --port. Split on whitespace only, so a single value containing spaces (such as a quoted path) is not supported. The server has no authentication; ReWrite always binds it to 127.0.0.1 and refuses to start if a --host here points at a non-loopback interface.')
			.addText((t) => {
				t.setValue(cfg.extraArgs);
				t.onChange(async (v) => {
					cfg.extraArgs = v;
					await this.commit();
				});
			});

		new Setting(parent)
			.setName('Start automatically')
			.setDesc('Start the server when Obsidian opens, if this device\'s profile uses local whisper.cpp. An already-running server from a previous session is adopted instead of doubled up.')
			.addToggle((t) => {
				t.setValue(cfg.autoStart);
				t.onChange(async (v) => {
					cfg.autoStart = v;
					await this.commit();
				});
			});

		new Setting(parent)
			.setName('Stop when idle')
			.setDesc('Minutes without a transcription before the server is stopped, freeing the model\'s memory. 0 keeps it running. Only servers started or adopted by ReWrite are stopped, and never mid-transcription.')
			.addText((t) => {
				t.inputEl.type = 'number';
				t.setValue(String(cfg.idleStopMinutes));
				t.setPlaceholder('0');
				t.onChange(async (v) => {
					const n = Number.parseInt(v, 10);
					cfg.idleStopMinutes = Number.isFinite(n) && n > 0 ? n : 0;
					await this.commit();
				});
			});

		const host = this.plugin.whisperHost;
		const snap = host.snapshot();

		const statusSetting = new Setting(parent).setName('Status').setDesc(formatWhisperStatus(snap));
		statusSetting.addButton((b) => {
			if (snap.status === 'running' || snap.status === 'starting') {
				b.setButtonText('Stop').onClick(() => void this.runGuardedButton(b, async () => {
					try {
						await host.stop();
					} catch (e) {
						console.error('ReWrite: whisper-host stop failed', e);
						new Notice(e instanceof Error ? e.message : String(e));
					}
					this.display();
				}));
			} else if (snap.status === 'external') {
				b.setButtonText('External').setDisabled(true).setTooltip('Not started by ReWrite. Stop the process from your task manager.');
			} else {
				b.setButtonText('Start').setCta().onClick(() => void this.runGuardedButton(b, async () => {
					try {
						await host.start(cfg);
					} catch (e) {
						console.error('ReWrite: whisper-host start failed', e);
						new Notice(e instanceof Error ? e.message : String(e));
					}
					this.display();
				}));
			}
		});
		statusSetting.addExtraButton((b) => {
			b.setIcon('refresh-cw').setTooltip('Probe the configured port for an existing server').onClick(() => void this.runGuardedButton(b, async () => {
				try {
					await host.probe(cfg);
				} catch (e) {
					console.error('ReWrite: whisper-host probe failed', e);
					new Notice(e instanceof Error ? e.message : String(e));
				}
				this.display();
			}));
		});

		const log = host.getLog();
		if (log) {
			const logDetails = parent.createEl('details', { cls: 'rewrite-log-disclosure' });
			logDetails.createEl('summary', { text: 'View log' });
			const pre = logDetails.createEl('pre', { cls: 'rewrite-log' });
			pre.setText(log.slice(-50_000));
		}
	}

	private renderTemplates(parent: HTMLElement): void {
		this.sectionHeading(parent, 'Templates', 'layout-template');
		parent.createEl('p', {
			text: 'Each template is a Markdown file in a vault folder. The text in the file is the prompt. The frontmatter holds its settings. Files show up in name order, so put a number in front of a name to set the order.',
			cls: 'rewrite-section-desc',
		});
		wikiLinkParagraph(parent, 'Full guide to the template format, every frontmatter field, and writing prompts: ', 'Creating templates', 'Creating-Templates');

		const s = this.plugin.settings;

		new Setting(parent)
			.setName('Templates folder')
			.setDesc('Vault-relative path. Created by the populate button if it does not exist.')
			.addText((t) => {
				t.setValue(s.templatesFolderPath);
				t.onChange(async (v) => {
					s.templatesFolderPath = v;
					await this.commit();
					await this.plugin.refreshTemplates();
				});
			});

		new Setting(parent)
			.setName('Populate or update default templates')
			.setDesc('Populate writes the built-in templates and shared core if they are missing, skipping anything that already exists. Update reconciles your built-in-derived templates with the current defaults: it fills in new fields and properties, brings unedited prompts forward, restores any you deleted, keeps your edits, and writes a report for anything it cannot safely merge. Load prior versions drops earlier shipped versions of the prompts in as separate templates so you can compare them.')
			.addButton((b) => {
				b.setButtonText('Populate').setCta().onClick(() => void this.runGuardedButton(b, async () => {
					try {
						const result = await populateDefaultTemplates(this.app, s.templatesFolderPath, new Set(s.disabledDefaultTemplateIds));
						await this.plugin.refreshTemplates();
						// The shared core is load-bearing for the default templates' quality
						// (it carries the guardrail + output discipline), so seed it alongside.
						const coreCreated = await populateDefaultSharedCore(this.app, s.sharedCorePath);
						await this.plugin.refreshSharedCore();
						const coreNote = coreCreated ? ` Created ${s.sharedCorePath}.` : '';
						new Notice(`ReWrite: populated ${result.folder}. Created ${result.created}, skipped ${result.skipped}.${coreNote}`);
						this.display();
					} catch (e) {
						console.error('ReWrite: populate templates failed', e);
						new Notice(`ReWrite: populate failed. ${e instanceof Error ? e.message : String(e)}`);
					}
				}));
			})
			.addButton((b) => {
				b.setButtonText('Update').onClick(() => void this.runGuardedButton(b, async () => {
					try {
						const result = await updateDefaultTemplates(this.app, s.templatesFolderPath, new Set(s.disabledDefaultTemplateIds));
						await this.plugin.refreshTemplates();
						const reviewNote = result.conflicts > 0
							? ` ${result.conflicts} need review.`
							: '';
						const failNote = result.parseFailed > 0
							? ` ${result.parseFailed} unparseable, skipped.`
							: '';
						const untrackedNote = result.untracked > 0
							? ` ${result.untracked} untracked, left alone.`
							: '';
						const reportNote = result.reportPath ? ` See ${result.reportPath}.` : '';
						new Notice(`ReWrite: updated templates in ${result.folder}. ${result.updated} updated, ${result.created} created, ${result.unchanged} unchanged.${reviewNote}${failNote}${untrackedNote}${reportNote}`);
						this.display();
					} catch (e) {
						console.error('ReWrite: update templates failed', e);
						new Notice(`ReWrite: update failed. ${e instanceof Error ? e.message : String(e)}`);
					}
				}));
			})
			.addButton((b) => {
				b.setButtonText('Load prior versions').onClick(() => void this.runGuardedButton(b, async () => {
					try {
						const result = await loadPriorTemplateVersions(this.app, s.templatesFolderPath);
						await this.plugin.refreshTemplates();
						if (result.available === 0) {
							new Notice('ReWrite: no prior template versions are available yet.');
						} else {
							new Notice(`ReWrite: loaded prior versions into ${result.folder}. Created ${result.created}, skipped ${result.skipped}.`);
						}
						this.display();
					} catch (e) {
						console.error('ReWrite: load prior versions failed', e);
						new Notice(`ReWrite: load prior versions failed. ${e instanceof Error ? e.message : String(e)}`);
					}
				}));
			});

		this.renderManageDefaults(parent);

		const loaded = this.plugin.templates;
		const listDesc = loaded.length === 0
			? 'No templates loaded. Set a folder path and click Populate, or add your own Markdown files there.'
			: `Loaded ${loaded.length} template${loaded.length === 1 ? '' : 's'}: ${loaded.map((t) => t.name).join(', ')}.`;
		parent.createEl('p', { text: listDesc, cls: 'rewrite-section-desc' });

		// Surface templates that opt out of the shared core: doing so drops the
		// anti-injection guardrail and output discipline that the shared core carries,
		// so the user should know which templates run without it.
		const noGuardrail = loaded.filter((t) => t.disableSharedCore === true);
		if (noGuardrail.length > 0) {
			const warn = parent.createEl('p', { cls: 'rewrite-section-desc rewrite-warning-text' });
			warn.createEl('strong', { text: 'Shared core disabled: ' });
			warn.createSpan({
				text: `${noGuardrail.map((t) => t.name).join(', ')}. ${noGuardrail.length === 1 ? 'This template runs' : 'These templates run'} without the shared core, so the anti-injection guardrail and output rules it carries do not apply. Vault and transcript text reach the model with less protection.`,
			});
		}

		if (loaded.length > 0) {
			new Setting(parent)
				.setName('Default template')
				.setDesc('Used by quick record and pre-selected in the modal.')
				.addDropdown((dd) => {
					dd.addOption('', '(first loaded)');
					for (const tpl of loaded) dd.addOption(tpl.id, tpl.name);
					dd.setValue(loaded.some((t) => t.id === s.defaultTemplateId) ? s.defaultTemplateId : '');
					dd.onChange(async (v) => {
						s.defaultTemplateId = v;
						await this.commit();
					});
				});

			new Setting(parent)
				.setName('Quick record (set template)')
				.setDesc('Template used by the quick record (set template) command.')
				.addDropdown((dd) => {
					dd.addOption('', '(none, choose one)');
					for (const tpl of loaded) dd.addOption(tpl.id, tpl.name);
					dd.setValue(loaded.some((t) => t.id === s.quickRecordTemplateId) ? s.quickRecordTemplateId : '');
					dd.onChange(async (v) => {
						s.quickRecordTemplateId = v;
						await this.commit();
					});
				});
		}

		new Setting(parent)
			.setName('On filename collision')
			.setDesc('What to do when a new-file template targets a path that already exists.')
			.addDropdown((dd) => {
				const opts: Array<{ id: NewFileCollisionMode; label: string }> = [
					{ id: 'auto', label: 'Auto-iterate (-1, -2, ...)' },
					{ id: 'prompt', label: 'Prompt for a new name' },
				];
				for (const opt of opts) dd.addOption(opt.id, opt.label);
				dd.setValue(s.newFileCollisionMode);
				dd.onChange(async (v) => {
					s.newFileCollisionMode = v as NewFileCollisionMode;
					await this.commit();
				});
			});
	}

	// Per-default checklist. Each row has two clearly-labelled, visually-distinct
	// controls: an "Enabled" switch (off = delete the file and add the id to
	// disabledDefaultTemplateIds so Populate/Update never re-add it) and a "Tracked"
	// checkbox (off = write `managed: false` so Update leaves the file alone). The
	// switch-vs-checkbox split, plus inline labels, makes which control does what
	// legible without hovering. Driven off freshDefaultTemplates() so the list stays
	// in sync as defaults come and go; on-disk state comes from the loaded cache.
	private renderManageDefaults(parent: HTMLElement): void {
		const s = this.plugin.settings;
		const details = parent.createEl('details', { cls: 'rewrite-manage-defaults' });
		details.open = this.manageDefaultsExpanded;
		details.addEventListener('toggle', () => {
			this.manageDefaultsExpanded = details.open;
		});
		details.createEl('summary', { text: 'Manage built-in templates' });
		const intro = details.createEl('p', { cls: 'rewrite-section-desc' });
		intro.createSpan({ cls: 'rewrite-manage-legend-term', text: 'Enabled' });
		intro.appendText(' keeps the template in your folder; turning it off deletes the file and stops the populate and update buttons from bringing it back. ');
		intro.createSpan({ cls: 'rewrite-manage-legend-term', text: 'Tracked' });
		intro.appendText(' lets the update button keep the template current; unchecking it freezes your copy so updates never change it again.');

		const disabled = new Set(s.disabledDefaultTemplateIds);
		for (const def of freshDefaultTemplates()) {
			const isDisabled = disabled.has(def.id);
			const onDisk = this.plugin.templates.find((t) => t.id === def.id);
			const tracked = onDisk ? onDisk.managed !== false : true;
			const state = isDisabled
				? 'Off. The file was removed; Populate and Update skip it.'
				: !onDisk
					? 'Not in your folder yet. Populate or Update will add it.'
					: tracked
						? 'In your folder. Update keeps it current.'
						: 'In your folder, frozen. Update leaves it alone.';

			const row = new Setting(details).setName(def.name).setDesc(state);
			row.settingEl.addClass('rewrite-manage-row');

			// Tracked control first, so the row reads [Tracked ☑] [Enabled ⊙] left to
			// right. The "Tracked" caption precedes the checkbox inside the label. Only
			// meaningful for an enabled, on-disk template.
			if (!isDisabled && onDisk) {
				const trackField = row.controlEl.createEl('label', { cls: 'rewrite-manage-check' });
				// Caption reflects the current state (the tab re-renders on toggle), matching
				// the Enabled/Disabled switch caption beside it.
				trackField.createSpan({ text: tracked ? 'Tracked' : 'Untracked' });
				const cb = trackField.createEl('input', { type: 'checkbox' });
				cb.checked = tracked;
				cb.setAttribute('aria-label', 'Tracked: keep this template current on update');
				cb.addEventListener('change', () => {
					void this.setDefaultTemplateTracked(def.id, cb.checked);
				});
			}

			// Enabled/Disabled caption + the switch, added last so the switch sits at the far
			// right. The caption reflects the current state (the whole tab re-renders on toggle).
			row.controlEl.createSpan({
				cls: 'rewrite-manage-switch-label',
				text: isDisabled ? 'Disabled' : 'Enabled',
			});
			row.addToggle((t) => {
				t.setValue(!isDisabled);
				t.setTooltip(isDisabled ? 'Turn on to re-create the file' : 'Turn off to remove the file');
				t.onChange((v) => {
					if (!v) {
						new ConfirmModal({
							app: this.app,
							title: 'Disable built-in template',
							body: `This removes "${def.name}" from your templates folder and stops Populate and Update from re-adding it, including after plugin updates. Any edits you made to the file are lost. You can turn it back on later to get a fresh copy.`,
							confirmLabel: 'Disable and remove',
							confirmCls: 'mod-warning',
							onConfirm: async () => {
								await this.disableDefaultTemplate(def.id);
							},
							onCancel: () => this.display(),
						}).open();
						return;
					}
					void this.enableDefaultTemplate(def.id);
				});
			});
		}
	}

	private async disableDefaultTemplate(id: string): Promise<void> {
		const s = this.plugin.settings;
		if (!s.disabledDefaultTemplateIds.includes(id)) {
			s.disabledDefaultTemplateIds.push(id);
		}
		await this.commit();
		try {
			const file = await findTemplateFileById(this.app, s.templatesFolderPath, id);
			if (file) await this.app.fileManager.trashFile(file);
		} catch (e) {
			console.error('ReWrite: could not remove disabled template file', e);
			new Notice(`ReWrite: template disabled, but its file could not be removed. ${e instanceof Error ? e.message : String(e)}`);
		}
		await this.plugin.refreshTemplates();
		this.display();
	}

	private async enableDefaultTemplate(id: string): Promise<void> {
		const s = this.plugin.settings;
		s.disabledDefaultTemplateIds = s.disabledDefaultTemplateIds.filter((v) => v !== id);
		await this.commit();
		try {
			await restoreDefaultTemplate(this.app, s.templatesFolderPath, id);
		} catch (e) {
			console.error('ReWrite: could not re-create enabled template', e);
			new Notice(`ReWrite: template enabled, but its file could not be re-created. ${e instanceof Error ? e.message : String(e)}`);
		}
		await this.plugin.refreshTemplates();
		this.display();
	}

	private async setDefaultTemplateTracked(id: string, tracked: boolean): Promise<void> {
		const s = this.plugin.settings;
		try {
			const file = await findTemplateFileById(this.app, s.templatesFolderPath, id);
			if (!file) {
				new Notice('ReWrite: template file not found.');
				this.display();
				return;
			}
			// Edit just the frontmatter key in place (preserves the body and any
			// user formatting) rather than re-rendering the whole file.
			await this.app.fileManager.processFrontMatter(file, (fm) => {
				Object.assign(fm, { managed: tracked });
			});
		} catch (e) {
			console.error('ReWrite: could not update managed flag', e);
			new Notice(`ReWrite: could not update the template. ${e instanceof Error ? e.message : String(e)}`);
		}
		await this.plugin.refreshTemplates();
		this.display();
	}

	private renderRecording(parent: HTMLElement): void {
		this.sectionHeading(parent, 'Recording', 'mic');
		new Setting(parent)
			.setName('Audio format preference')
			.setDesc('Use mp4 on iOS, otherwise webm.')
			.addDropdown((dd) => {
				for (const opt of RECORDING_FORMAT_OPTIONS) dd.addOption(opt.id, opt.label);
				dd.setValue(this.plugin.settings.recordingFormat);
				dd.onChange(async (v) => {
					this.plugin.settings.recordingFormat = v as RecordingFormatPreference;
					await this.commit();
				});
			});

		new Setting(parent)
			.setName('Attachments folder')
			.setDesc('Folder in your vault for saved recordings. Leave it empty to use your vault\'s own attachments setting. Each recording is linked at the top of the cleaned note.')
			.addText((t) => {
				t.setValue(this.plugin.settings.attachmentsFolderPath);
				t.setPlaceholder('Attachments');
				t.onChange(async (v) => {
					this.plugin.settings.attachmentsFolderPath = v;
					await this.commit();
				});
			});
	}

	private renderAutoIngest(parent: HTMLElement): void {
		this.sectionHeading(parent, 'Auto-ingest folders', 'folder-input');
		parent.createEl('p', {
			text: 'Drop audio files from outside Obsidian into a vault folder, then run the process auto-ingest folders command from the command palette. Each file becomes a note using the folder\'s template, and the recording is moved in with your other saved recordings. Files that fail stay in the folder and are retried the next time you run the command.',
			cls: 'rewrite-section-desc',
		});

		const s = this.plugin.settings;
		s.ingestRules.forEach((rule, index) => {
			const template = this.plugin.templates.find((t) => t.id === rule.templateId);
			const problem = !template
				? ' Warning: template is missing; this rule will be skipped.'
				: template.insertMode !== 'newFile'
					? ' Warning: template does not create a new file; this rule will be skipped.'
					: '';
			new Setting(parent)
				.setName(rule.folderPath)
				.setDesc(`Template: ${template?.name ?? rule.templateId}.${problem}`)
				.addToggle((t) => {
					t.setValue(rule.enabled);
					t.setTooltip('Enabled');
					t.onChange(async (v) => {
						rule.enabled = v;
						await this.commit();
					});
				})
				.addButton((b) => {
					b.setButtonText('Edit').onClick(() => {
						new IngestRuleModal({
							app: this.app,
							templates: this.plugin.templates,
							rule,
							onSubmit: async (updated) => {
								s.ingestRules[index] = updated;
								await this.commit();
								this.display();
							},
						}).open();
					});
				})
				.addExtraButton((b) => {
					b.setIcon('trash-2').setTooltip('Delete rule').onClick(() => {
						void (async () => {
							s.ingestRules.splice(index, 1);
							await this.commit();
							this.display();
						})();
					});
				});
		});

		new Setting(parent)
			.setName(s.ingestRules.length === 0 ? 'No ingest folders yet' : 'Add another folder')
			.addButton((b) => {
				b.setButtonText('Add ingest folder').setCta().onClick(() => {
					new IngestRuleModal({
						app: this.app,
						templates: this.plugin.templates,
						onSubmit: async (rule) => {
							s.ingestRules.push(rule);
							await this.commit();
							this.display();
						},
					}).open();
				});
			});
	}

	private renderAdHocInstructions(parent: HTMLElement): void {
		this.sectionHeading(parent, 'Ad-hoc instructions', 'message-square');
		parent.createEl('p', {
			text: 'Say the assistant\'s name while you talk, then a comma, then what you want it to do. The plugin takes that part out of your words and passes it to the cleanup step as a note. This is off by default. Pick an unusual name. Common everyday words will set it off by mistake.',
			cls: 'rewrite-section-desc',
		});

		new Setting(parent)
			.setName('Enabled')
			.setDesc('Look through your text for the assistant name and pull out any instructions you spoke.')
			.addToggle((t) => {
				t.setValue(this.plugin.settings.adHocInstructionsEnabled);
				t.onChange(async (v) => {
					this.plugin.settings.adHocInstructionsEnabled = v;
					await this.commit();
					this.display();
				});
			});

		if (this.plugin.settings.adHocInstructionsEnabled) {
			new Setting(parent)
				.setName('Assistant name')
				.setDesc('The name the assistant listens for. Speech to text can get unusual names wrong, so expect a miss now and then.')
				.addText((t) => {
					t.setValue(this.plugin.settings.assistantName);
					t.setPlaceholder('Scrivener');
					t.onChange(async (v) => {
						this.plugin.settings.assistantName = v;
						await this.commit();
					});
				});

			new Setting(parent)
				.setName('Assistant prompt file')
				.setDesc('Path in your vault to a Markdown file. Its text goes above the list of your spoken instructions in the prompt. Edit it like any note to tell the model how to use those instructions.')
				.addText((t) => {
					t.setValue(this.plugin.settings.assistantPromptPath);
					t.setPlaceholder('ReWrite/AssistantPrompt.md');
					t.onChange(async (v) => {
						this.plugin.settings.assistantPromptPath = v;
						await this.commit();
						await this.plugin.refreshAssistantPrompt();
					});
				});

			new Setting(parent)
				.setName('Populate default assistant prompt')
				.setDesc('Writes the built-in default into the file above. Skipped if the file already exists.')
				.addButton((b) => {
					b.setButtonText('Populate').setCta().onClick(() => void this.runGuardedButton(b, async () => {
						try {
							const created = await populateDefaultAssistantPrompt(this.app, this.plugin.settings.assistantPromptPath);
							await this.plugin.refreshAssistantPrompt();
							new Notice(created
								? `ReWrite: created ${this.plugin.settings.assistantPromptPath}.`
								: `ReWrite: ${this.plugin.settings.assistantPromptPath} already exists.`);
							this.display();
						} catch (e) {
							console.error('ReWrite: populate assistant prompt failed', e);
							new Notice(`ReWrite: ${e instanceof Error ? e.message : String(e)}`);
						}
					}));
				})
				.addExtraButton((b) => {
					b.setIcon('external-link').setTooltip('Open file in a new pane').onClick(() => {
						const path = this.plugin.settings.assistantPromptPath.trim();
						if (!path) {
							new Notice('Set an assistant prompt path first.');
							return;
						}
						void this.app.workspace.openLinkText(path, '', true);
					});
				});

			const loaded = this.plugin.assistantPrompt;
			parent.createEl('p', {
				text: loaded
					? `Loaded ${loaded.length.toLocaleString()} characters from ${this.plugin.settings.assistantPromptPath}.`
					: 'No assistant prompt loaded. The built-in default is used until you populate or write the file.',
				cls: 'rewrite-section-desc',
			});
		}
	}

	private renderSharedCore(parent: HTMLElement): void {
		const heading = this.sectionHeading(parent, 'Shared core', 'layers');
		const enabled = this.plugin.sharedCore !== null;
		heading.nameEl.createSpan({
			cls: `rewrite-status-badge ${enabled ? 'is-enabled' : 'is-disabled'}`,
			text: enabled ? 'Enabled' : 'Disabled',
		});
		parent.createEl('p', {
			text: 'One vault file that is added to the front of every template prompt. It holds the safety rule, the basic cleanup rules, and the output rules. Edit it once to change the baseline for all templates. It is sent on every cleanup, so keep it short to save tokens. To skip it for one template, add "disableSharedCore: true" to that template\'s frontmatter. If you delete or empty this file, the shared core is turned off for the whole plugin.',
			cls: 'rewrite-section-desc',
		});

		new Setting(parent)
			.setName('Shared core file')
			.setDesc('Path in your vault. The file body is the shared text. Any frontmatter is just notes for you and is not sent to the model.')
			.addText((t) => {
				t.setValue(this.plugin.settings.sharedCorePath);
				t.setPlaceholder('ReWrite/SharedCore.md');
				t.onChange(async (v) => {
					this.plugin.settings.sharedCorePath = v;
					await this.commit();
					await this.plugin.refreshSharedCore();
				});
			});

		new Setting(parent)
			.setName('Re-create shared core file')
			.setDesc('Writes a starter file with the default shared core. Skipped if the file already exists; delete the file first to restore the default.')
			.addButton((b) => {
				b.setButtonText('Populate').setCta().onClick(() => void this.runGuardedButton(b, async () => {
					try {
						const created = await populateDefaultSharedCore(this.app, this.plugin.settings.sharedCorePath);
						await this.plugin.refreshSharedCore();
						new Notice(created
							? `ReWrite: created ${this.plugin.settings.sharedCorePath}.`
							: `ReWrite: ${this.plugin.settings.sharedCorePath} already exists.`);
						this.display();
					} catch (e) {
						console.error('ReWrite: populate shared core failed', e);
						new Notice(`ReWrite: ${e instanceof Error ? e.message : String(e)}`);
					}
				}));
			})
			.addExtraButton((b) => {
				b.setIcon('external-link').setTooltip('Open file in a new pane').onClick(() => {
					const path = this.plugin.settings.sharedCorePath.trim();
					if (!path) {
						new Notice('Set a shared core path first.');
						return;
					}
					void this.app.workspace.openLinkText(path, '', true);
				});
			});

		const loaded = this.plugin.sharedCore;
		parent.createEl('p', {
			text: loaded
				? `Loaded ${loaded.length.toLocaleString()} characters. Prepended to every template prompt unless disabled per template.`
				: 'No shared core loaded. Template prompts are sent as-is, with no shared preface.',
			cls: 'rewrite-section-desc',
		});
	}

	private renderKnownNouns(parent: HTMLElement): void {
		this.sectionHeading(parent, 'Known nouns', 'book-open');
		parent.createEl('p', {
			text: 'A vault file that lists names the model should keep exactly as written, plus any common mishearings. The list is added to every cleanup prompt. Keep it short, with only the names the model gets wrong. A long list raises the token cost of every recording.',
			cls: 'rewrite-section-desc',
		});

		new Setting(parent)
			.setName('Known nouns file')
			.setDesc('Path in your vault. Frontmatter is just notes for you. In the body, put one name per line. You can add ": alt1, alt2" after a name to list common mishearings.')
			.addText((t) => {
				t.setValue(this.plugin.settings.knownNounsPath);
				t.setPlaceholder('ReWrite/KnownNouns.md');
				t.onChange(async (v) => {
					this.plugin.settings.knownNounsPath = v;
					await this.commit();
					await this.plugin.refreshKnownNouns();
				});
			});

		new Setting(parent)
			.setName('Populate default known nouns')
			.setDesc('Writes a starter file with guidance frontmatter and example nouns. Skipped if the file already exists.')
			.addButton((b) => {
				b.setButtonText('Populate').setCta().onClick(() => void this.runGuardedButton(b, async () => {
					try {
						const created = await populateDefaultKnownNouns(this.app, this.plugin.settings.knownNounsPath);
						await this.plugin.refreshKnownNouns();
						new Notice(created
							? `ReWrite: created ${this.plugin.settings.knownNounsPath}.`
							: `ReWrite: ${this.plugin.settings.knownNounsPath} already exists.`);
						this.display();
					} catch (e) {
						console.error('ReWrite: populate known nouns failed', e);
						new Notice(`ReWrite: ${e instanceof Error ? e.message : String(e)}`);
					}
				}));
			})
			.addExtraButton((b) => {
				b.setIcon('external-link').setTooltip('Open file in a new pane').onClick(() => {
					const path = this.plugin.settings.knownNounsPath.trim();
					if (!path) {
						new Notice('Set a known nouns path first.');
						return;
					}
					void this.app.workspace.openLinkText(path, '', true);
				});
			});

		const loaded = this.plugin.knownNouns;
		parent.createEl('p', {
			text: loaded.length === 0
				? 'No known nouns loaded. The "Known nouns" section is omitted from the system prompt.'
				: `Loaded ${loaded.length} noun${loaded.length === 1 ? '' : 's'}: ${loaded.map((n) => n.canonical).join(', ')}.`,
			cls: 'rewrite-section-desc',
		});
	}
}

type ModelFieldMode = 'plain' | 'empty-cache' | 'dropdown' | 'custom';

function modelFieldDesc(hint: string, mode: ModelFieldMode): string {
	switch (mode) {
		case 'plain':
			return hint;
		case 'empty-cache':
			return `${hint} Click Refresh to load models from the provider.`;
		case 'dropdown':
			return `${hint} Pick a model, or choose Custom... to type one.`;
		case 'custom':
			return `${hint} Type a model ID, or use Back to list.`;
	}
}

/**
 * Sets the model-field description, appending a "list of models" external link when
 * the provider has no listModels endpoint but does publish a models doc page
 * (assemblyai, revai). Providers without a doc link get the plain string desc.
 */
function applyModelFieldDesc(
	setting: Setting,
	hint: string,
	mode: ModelFieldMode,
	docsUrl: string | null,
): void {
	const text = modelFieldDesc(hint, mode);
	if (!docsUrl) {
		setting.setDesc(text);
		return;
	}
	const linkLabel = 'list of models';
	const frag = activeDocument.createDocumentFragment();
	frag.appendText(text ? `${text} See the ` : 'See the ');
	const a = frag.createEl('a', { text: linkLabel, href: docsUrl });
	a.target = '_blank';
	a.rel = 'noopener noreferrer';
	frag.appendText('.');
	setting.setDesc(frag);
}

/** Models documentation page for providers that have no listModels endpoint. */
function transcriptionModelDocsUrl(id: TranscriptionProviderID): string | null {
	switch (id) {
		case 'assemblyai':
			return 'https://www.assemblyai.com/docs/getting-started/models';
		case 'revai':
			return 'https://docs.rev.ai/api/asynchronous/transcribers/';
		default:
			return null;
	}
}

function transcriptionModelHint(id: TranscriptionProviderID): string {
	switch (id) {
		case 'none':
			return '';
		case 'openai':
			return 'e.g. whisper-1';
		case 'groq':
			return 'e.g. whisper-large-v3-turbo';
		case 'assemblyai':
			return 'Optional. e.g. universal or nano';
		case 'deepgram':
			return 'e.g. nova-2 or nova-3';
		case 'revai':
			return 'Optional transcriber name';
		case 'mistral-voxtral':
			return 'e.g. voxtral-mini-latest or voxtral-small-latest';
		case 'openai-compatible':
			return 'Whichever model your local server exposes';
		case 'whisper-local':
			return 'Any value works; the loaded model is set at server start.';
	}
}

function llmModelHint(id: LLMProviderID): string {
	switch (id) {
		case 'none':
			return '';
		case 'anthropic':
			return 'e.g. claude-sonnet-4-5 or claude-haiku-4-5-20251001';
		case 'openai':
			return 'e.g. gpt-4o-mini';
		case 'gemini':
			return 'e.g. gemini-2.0-flash';
		case 'mistral':
			return 'e.g. mistral-large-latest';
		case 'openai-compatible':
			return 'Whichever model your local server exposes';
	}
}
