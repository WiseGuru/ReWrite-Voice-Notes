import { App, Notice, Platform, PluginSettingTab, Setting } from 'obsidian';
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
import { createLLMProvider } from '../llm';
import { formatWhisperStatus } from '../whisper-host';
import { populateDefaultTemplates } from '../templates-folder';
import { populateDefaultAssistantPrompt } from '../assistant-prompt';
import { populateDefaultKnownNouns } from '../known-nouns';
import { changeEncryptionMode, EncryptionMode, lockSecrets } from '../secrets';
import { hydrateSecrets } from '.';
import { PassphraseModal } from '../ui/passphrase-modal';

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
	{ id: 'openai-compatible', label: 'OpenAI-compatible (local server)' },
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

	constructor(app: App, private readonly plugin: ReWritePlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass('rewrite-settings');

		this.renderEncryption(containerEl);
		this.renderActiveProfile(containerEl);
		this.renderProfile(containerEl, 'desktop');
		this.renderProfile(containerEl, 'mobile');
		this.renderLocalWhisperServer(containerEl);
		this.renderTemplates(containerEl);
		this.renderRecording(containerEl);
		this.renderAdHocInstructions(containerEl);
		this.renderKnownNouns(containerEl);
	}

	private async commit(): Promise<void> {
		await this.plugin.saveSettings();
	}

	private apiKeyPlaceholder(): string {
		if (this.plugin.encryptionStatus.locked) return 'Locked. Unlock to view or edit.';
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
		if (status.locked) {
			banner.addClass('is-locked');
			banner.createEl('strong', { text: 'API keys are locked.' });
			banner.createEl('span', {
				text: ' Enter your passphrase to decrypt them. Until then, recording and processing are disabled.',
			});
			const unlockBtn = banner.createEl('button', { text: 'Unlock', cls: 'mod-cta' });
			unlockBtn.addEventListener('click', () => {
				this.plugin.promptUnlock(() => this.display());
			});
		} else if (status.mode === 'plaintext') {
			banner.addClass('is-warning');
			banner.createEl('strong', { text: 'Plaintext storage.' });
			banner.createEl('span', {
				text: ' Your API keys are stored unencrypted on this device. Any process running as your user account can read them. Switch to a passphrase below to encrypt them.',
			});
		} else if (status.mode === 'safeStorage') {
			banner.addClass('is-ok');
			const backend = status.safeStorageBackend ? ` (${status.safeStorageBackend})` : '';
			banner.createEl('span', { text: `Encrypted via OS keychain${backend}.` });
		} else if (status.mode === 'passphrase') {
			banner.addClass('is-ok');
			banner.createEl('span', { text: 'Encrypted with passphrase. Unlocked for this session.' });
		}

		new Setting(parent).setName('API key encryption').setHeading();

		parent.createEl('p', {
			text: 'Choose how your API keys are protected on disk. Keys are stored in secrets.json.nosync in the plugin folder; this setting controls how they are encrypted.',
			cls: 'rewrite-section-desc',
		});

		new Setting(parent)
			.setName('Encryption mode')
			.setDesc(this.encryptionModeDescription(status))
			.addDropdown((dd) => {
				if (status.safeStorageAvailable) dd.addOption('safeStorage', 'OS keychain (recommended)');
				dd.addOption('passphrase', 'Passphrase (cross-platform)');
				dd.addOption('plaintext', 'Plaintext (not recommended)');
				dd.setValue(status.mode);
				dd.onChange((v) => {
					const next = v as EncryptionMode;
					if (next === status.mode) return;
					void this.handleModeChange(next);
				});
			});

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
							onSubmit: async (pass) => {
								await changeEncryptionMode(this.plugin, 'passphrase', pass);
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
					b.setButtonText('Lock').onClick(async () => {
						lockSecrets();
						await hydrateSecrets(this.plugin, this.plugin.settings);
						await this.plugin.refreshEncryptionStatus();
						this.display();
					});
				});
		}
	}

	private encryptionModeDescription(status: { mode: EncryptionMode; safeStorageAvailable: boolean; safeStorageBackend: string | null }): string {
		const lines: string[] = [];
		if (status.safeStorageAvailable) {
			lines.push(`OS keychain: encrypted by your operating system (${status.safeStorageBackend ?? 'detected'}). Strongest, but only works on this machine.`);
		} else {
			lines.push('OS keychain: not available on this device (no working keyring detected).');
		}
		lines.push('Passphrase: AES-GCM with PBKDF2-derived key. You enter a passphrase once per session. Works on every platform, including mobile.');
		lines.push('Plaintext: no encryption. Any process running as your user can read your keys.');
		return lines.join(' ');
	}

	private async handleModeChange(next: EncryptionMode): Promise<void> {
		try {
			if (next === 'passphrase') {
				new PassphraseModal({
					app: this.app,
					title: 'Set a passphrase',
					description: 'A passphrase will be used to encrypt your API keys. Store it in your password manager; there is no recovery if you forget it.',
					confirmLabel: 'Save',
					requireConfirm: true,
					onSubmit: async (pass) => {
						await changeEncryptionMode(this.plugin, 'passphrase', pass);
						await this.plugin.refreshEncryptionStatus();
						new Notice('ReWrite: passphrase encryption enabled.');
						this.display();
					},
				}).open();
				// Modal cancel or completion handles re-render; re-render now so the dropdown
				// doesn't appear "applied" until the user confirms.
				this.display();
				return;
			}
			await changeEncryptionMode(this.plugin, next);
			await this.plugin.refreshEncryptionStatus();
			const label = next === 'safeStorage' ? 'OS keychain' : 'plaintext';
			new Notice(`ReWrite: switched to ${label} storage.`);
			this.display();
		} catch (e) {
			new Notice(`ReWrite: ${e instanceof Error ? e.message : String(e)}`);
			await this.plugin.refreshEncryptionStatus();
			this.display();
		}
	}

	private renderActiveProfile(parent: HTMLElement): void {
		new Setting(parent).setName('Active profile').setHeading();
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

		const heading = new Setting(section).setName(title).setHeading();
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
			this.renderTranscriptionModelField(body, profile);

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
		}

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
			this.renderLLMModelField(body, profile);

			if (profile.llmProvider === 'openai-compatible') {
				new Setting(body)
					.setName('LLM base URL')
					.setDesc('e.g. http://localhost:11434/v1 (Ollama) or http://localhost:1234/v1 (LM Studio)')
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
		}

		this.renderProfileAdvanced(body, profile);
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
				.setDesc('Maximum tokens for the cleanup response. Default 2048.')
				.addText((t) => {
					t.inputEl.type = 'number';
					t.setValue(String(profile.llmConfig.maxTokens));
					t.onChange(async (v) => {
						const n = Number.parseInt(v, 10);
						profile.llmConfig.maxTokens = Number.isFinite(n) && n > 0 ? n : 2048;
						await this.commit();
					});
				});
		}
	}

	private renderTranscriptionModelField(parent: HTMLElement, profile: EnvironmentProfile): void {
		const wrapper = parent.createDiv({ cls: 'rewrite-model-field' });
		this.populateTranscriptionModelField(wrapper, profile);
	}

	private populateTranscriptionModelField(wrapper: HTMLElement, profile: EnvironmentProfile): void {
		wrapper.empty();
		const providerId = profile.transcriptionProvider;
		const provider = createTranscriptionProvider(providerId);
		const supportsList = typeof provider.listModels === 'function';
		const cached = this.plugin.settings.modelCache.transcription[providerId]?.ids ?? [];
		const current = profile.transcriptionConfig.model;

		const setting = new Setting(wrapper).setName('Transcription model');
		setting.setDesc(modelFieldDesc(transcriptionModelHint(providerId), supportsList, cached.length));

		if (supportsList) {
			setting.addDropdown((dd) => {
				dd.addOption('', cached.length === 0 ? '(no cached models)' : '(pick a model)');
				for (const id of cached) dd.addOption(id, id);
				dd.setValue(cached.includes(current) ? current : '');
				dd.onChange(async (v) => {
					if (!v) return;
					profile.transcriptionConfig.model = v;
					await this.commit();
					this.populateTranscriptionModelField(wrapper, profile);
				});
			});
			setting.addExtraButton((b) => {
				b.setIcon('refresh-cw').setTooltip('Refresh model list').onClick(async () => {
					await this.refreshTranscriptionModels(providerId, profile.transcriptionConfig);
					this.populateTranscriptionModelField(wrapper, profile);
				});
			});
		}

		setting.addText((t) => {
			t.setValue(current);
			t.setPlaceholder(supportsList ? '' : transcriptionModelHint(providerId));
			t.onChange(async (v) => {
				profile.transcriptionConfig.model = v;
				await this.commit();
			});
		});
	}

	private renderLLMModelField(parent: HTMLElement, profile: EnvironmentProfile): void {
		const wrapper = parent.createDiv({ cls: 'rewrite-model-field' });
		this.populateLLMModelField(wrapper, profile);
	}

	private populateLLMModelField(wrapper: HTMLElement, profile: EnvironmentProfile): void {
		wrapper.empty();
		const providerId = profile.llmProvider;
		const provider = createLLMProvider(providerId);
		const supportsList = typeof provider.listModels === 'function';
		const cached = this.plugin.settings.modelCache.llm[providerId]?.ids ?? [];
		const current = profile.llmConfig.model;

		const setting = new Setting(wrapper).setName('LLM model');
		setting.setDesc(modelFieldDesc(llmModelHint(providerId), supportsList, cached.length));

		if (supportsList) {
			setting.addDropdown((dd) => {
				dd.addOption('', cached.length === 0 ? '(no cached models)' : '(pick a model)');
				for (const id of cached) dd.addOption(id, id);
				dd.setValue(cached.includes(current) ? current : '');
				dd.onChange(async (v) => {
					if (!v) return;
					profile.llmConfig.model = v;
					await this.commit();
					this.populateLLMModelField(wrapper, profile);
				});
			});
			setting.addExtraButton((b) => {
				b.setIcon('refresh-cw').setTooltip('Refresh model list').onClick(async () => {
					await this.refreshLLMModels(providerId, profile.llmConfig);
					this.populateLLMModelField(wrapper, profile);
				});
			});
		}

		setting.addText((t) => {
			t.setValue(current);
			t.setPlaceholder(supportsList ? '' : llmModelHint(providerId));
			t.onChange(async (v) => {
				profile.llmConfig.model = v;
				await this.commit();
			});
		});
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

		new Setting(parent).setName('Local whisper.cpp server (desktop)').setHeading();
		parent.createEl('p', {
			text: 'Spawn a user-supplied whisper-server binary so transcription happens fully on-device. The plugin only reads the paths you provide; it never downloads or discovers binaries.',
			cls: 'rewrite-section-desc',
		});

		const cfg = this.plugin.settings.localWhisper;

		new Setting(parent)
			.setName('Binary path')
			.setDesc('Absolute path to whisper-server (or whisper-server.exe on Windows).')
			.addText((t) => {
				t.setValue(cfg.binaryPath);
				t.setPlaceholder('/usr/local/bin/whisper-server');
				t.onChange(async (v) => {
					cfg.binaryPath = v;
					await this.commit();
				});
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
			.setDesc('Space-separated CLI args appended after -m, --port.')
			.addText((t) => {
				t.setValue(cfg.extraArgs);
				t.onChange(async (v) => {
					cfg.extraArgs = v;
					await this.commit();
				});
			});

		const host = this.plugin.whisperHost;
		const snap = host.snapshot();

		const statusSetting = new Setting(parent).setName('Status').setDesc(formatWhisperStatus(snap));
		statusSetting.addButton((b) => {
			if (snap.status === 'running' || snap.status === 'starting') {
				b.setButtonText('Stop').onClick(async () => {
					try {
						await host.stop();
					} catch (e) {
						new Notice(e instanceof Error ? e.message : String(e));
					}
					this.display();
				});
			} else if (snap.status === 'external') {
				b.setButtonText('External').setDisabled(true).setTooltip('Not started by ReWrite. Stop the process from your task manager.');
			} else {
				b.setButtonText('Start').setCta().onClick(async () => {
					try {
						await host.start(cfg);
					} catch (e) {
						new Notice(e instanceof Error ? e.message : String(e));
					}
					this.display();
				});
			}
		});
		statusSetting.addExtraButton((b) => {
			b.setIcon('refresh-cw').setTooltip('Probe the configured port for an existing server').onClick(async () => {
				try {
					await host.probe(cfg);
				} catch (e) {
					new Notice(e instanceof Error ? e.message : String(e));
				}
				this.display();
			});
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
		new Setting(parent).setName('Templates').setHeading();
		parent.createEl('p', {
			text: 'Templates live as Markdown files in a vault folder. The file body is the LLM prompt; frontmatter holds the metadata. Files are sorted by filename, so prefix with a number to control order.',
			cls: 'rewrite-section-desc',
		});

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
			.setName('Populate with default templates')
			.setDesc('Writes the five built-in templates into the folder above. Skips any whose ID already exists, so re-running tops up after a deletion.')
			.addButton((b) => {
				b.setButtonText('Populate').setCta().onClick(async () => {
					try {
						const result = await populateDefaultTemplates(this.app, s.templatesFolderPath);
						await this.plugin.refreshTemplates();
						new Notice(`ReWrite: populated ${result.folder}. Created ${result.created}, skipped ${result.skipped}.`);
						this.display();
					} catch (e) {
						new Notice(`ReWrite: populate failed. ${e instanceof Error ? e.message : String(e)}`);
					}
				});
			});

		const loaded = this.plugin.templates;
		const listDesc = loaded.length === 0
			? 'No templates loaded. Set a folder path and click Populate, or add your own Markdown files there.'
			: `Loaded ${loaded.length} template${loaded.length === 1 ? '' : 's'}: ${loaded.map((t) => t.name).join(', ')}.`;
		parent.createEl('p', { text: listDesc, cls: 'rewrite-section-desc' });

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

	private renderRecording(parent: HTMLElement): void {
		new Setting(parent).setName('Recording').setHeading();
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
			.setDesc('Vault-relative folder for saved recordings. Leave empty to use the vault\'s attachments setting. Each recording is embedded at the top of the cleaned output.')
			.addText((t) => {
				t.setValue(this.plugin.settings.attachmentsFolderPath);
				t.setPlaceholder('Attachments');
				t.onChange(async (v) => {
					this.plugin.settings.attachmentsFolderPath = v;
					await this.commit();
				});
			});
	}

	private renderAdHocInstructions(parent: HTMLElement): void {
		new Setting(parent).setName('Ad-hoc instructions').setHeading();
		parent.createEl('p', {
			text: 'Address the assistant by name mid-dictation, then a comma, then a directive. Matches are stripped from the transcript and appended to the cleanup prompt as numbered instructions. Off by default. Pick an uncommon word; common everyday words will misfire.',
			cls: 'rewrite-section-desc',
		});

		new Setting(parent)
			.setName('Enabled')
			.setDesc('Scan transcripts (all sources) for the assistant name and extract impromptu instructions.')
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
				.setDesc('The wake word the assistant listens for. Speech recognition may mangle uncommon names; expect occasional misses.')
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
				.setDesc('Vault-relative path to a Markdown file whose body is inserted above the numbered list of interjections in the system prompt. Edit it like a normal note to tell the LLM how to weight and apply ad-hoc directives.')
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
					b.setButtonText('Populate').setCta().onClick(async () => {
						try {
							const created = await populateDefaultAssistantPrompt(this.app, this.plugin.settings.assistantPromptPath);
							await this.plugin.refreshAssistantPrompt();
							new Notice(created
								? `ReWrite: created ${this.plugin.settings.assistantPromptPath}.`
								: `ReWrite: ${this.plugin.settings.assistantPromptPath} already exists.`);
							this.display();
						} catch (e) {
							new Notice(`ReWrite: ${e instanceof Error ? e.message : String(e)}`);
						}
					});
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

	private renderKnownNouns(parent: HTMLElement): void {
		new Setting(parent).setName('Known nouns').setHeading();
		parent.createEl('p', {
			text: 'A vault file listing proper nouns the LLM should preserve verbatim, with optional misheard alternates. The list is appended to every cleanup system prompt, so keep it focused on nouns the LLM actually mangles; an unbounded list inflates token cost on every recording.',
			cls: 'rewrite-section-desc',
		});

		new Setting(parent)
			.setName('Known nouns file')
			.setDesc('Vault-relative path. Frontmatter is for human-readable guidance only; the body is one noun per line, with an optional ": alt1, alt2" suffix for misheard variants.')
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
				b.setButtonText('Populate').setCta().onClick(async () => {
					try {
						const created = await populateDefaultKnownNouns(this.app, this.plugin.settings.knownNounsPath);
						await this.plugin.refreshKnownNouns();
						new Notice(created
							? `ReWrite: created ${this.plugin.settings.knownNounsPath}.`
							: `ReWrite: ${this.plugin.settings.knownNounsPath} already exists.`);
						this.display();
					} catch (e) {
						new Notice(`ReWrite: ${e instanceof Error ? e.message : String(e)}`);
					}
				});
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

function modelFieldDesc(hint: string, supportsList: boolean, cachedCount: number): string {
	if (!supportsList) return hint;
	if (cachedCount === 0) return `${hint} Or click Refresh to load models from the provider.`;
	return `${hint} Pick from the dropdown, or type a custom model name.`;
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
