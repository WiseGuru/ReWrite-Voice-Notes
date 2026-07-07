import { Editor, MarkdownFileInfo, MarkdownView, Notice, Platform, Plugin, TFile } from 'obsidian';
import { hydrateSecrets, loadSettings, saveSettings } from './settings';
import { ReWriteSettingTab } from './settings/tab';
import { ReWriteModal } from './ui/modal';
import { PassphraseModal } from './ui/passphrase-modal';
import { QuickRecordController, startQuickRecord } from './ui/quick-record';
import { resolveActiveTextSource, resolveTextFromEditor, runTextPipeline, TextResolution } from './ui/text-source';
import { TemplatePickerModal } from './ui/template-picker';
import { AudioFilePickerModal } from './ui/audio-file-picker';
import { collectAudioFiles, isAudioFile, runAudioFilePipeline } from './ui/audio-source';
import { WhisperStatusBar } from './ui/whisper-status-bar';
import { GlobalSettings, KnownNoun, NoteTemplate, PipelineHost } from './types';
import { WhisperHost } from './whisper-host';
import { bindWhisperHost } from './transcription/whisper-local';
import { resolveActiveProfile } from './platform';
import { isPathInTemplatesFolder, loadTemplatesFromFolder, pickDefaultTemplateId } from './templates-folder';
import { isPathSharedCore, loadSharedCoreFromFile } from './shared-core';
import { isPathAssistantPrompt, loadAssistantPromptFromFile } from './assistant-prompt';
import { isPathKnownNouns, loadKnownNounsFromFile } from './known-nouns';
import { setEncryptionMode, EncryptionStatus, getEncryptionStatus, unlockSecrets, warmSecretStorage } from './secrets';

type RefreshKind = 'templates' | 'sharedCore' | 'assistantPrompt' | 'knownNouns';

export default class ReWritePlugin extends Plugin implements PipelineHost {
	settings!: GlobalSettings;
	whisperHost!: WhisperHost;
	templates: NoteTemplate[] = [];
	sharedCore: string | null = null;
	assistantPrompt: string | null = null;
	knownNouns: KnownNoun[] = [];
	encryptionStatus!: EncryptionStatus;
	private activeQuickRecord: QuickRecordController | null = null;
	// Reserved synchronously before the async startQuickRecord() (which awaits getUserMedia)
	// resolves. activeQuickRecord alone isn't enough: it's only assigned after that await, so
	// two rapid hotkey presses would both see it null and each open a mic stream, orphaning
	// the first one.
	private quickRecordStarting = false;
	// Debounce timers for vault-event-triggered refreshes: an editor autosaving a template file
	// fires several `modify` events in quick succession, and each would otherwise trigger its
	// own full folder reload. Keyed per refresh kind so unrelated vault files don't share a timer.
	private pendingRefresh: Partial<Record<RefreshKind, number>> = {};
	// Generation counters guard against a stale, slower-resolving reload overwriting a newer one:
	// each refresh*() bumps its counter before awaiting and only applies the result if the
	// counter is still current when the load resolves.
	private templatesGen = 0;
	private sharedCoreGen = 0;
	private assistantPromptGen = 0;
	private knownNounsGen = 0;
	private unlockListeners = new Set<() => void>();

	async onload(): Promise<void> {
		// Warm the secret-storage probe BEFORE anything reads the secrets envelope. loadSettings ->
		// hydrateSecrets reads (and caches) the envelope, so the probe must be warm first; otherwise
		// a first run (no envelope yet) caches as unconfigured passphrase mode and never picks up
		// secret storage even when it is available.
		await warmSecretStorage(this);
		this.settings = await loadSettings(this);
		this.encryptionStatus = await getEncryptionStatus(this);
		this.whisperHost = new WhisperHost(this);
		bindWhisperHost(this.whisperHost);
		if (Platform.isDesktop) {
			void this.whisperHost.probe(this.settings.localWhisper).then((snap) => {
				if (snap.status === 'running' && snap.ownership === 'adopted') {
					new Notice(`ReWrite: adopted whisper-server from previous session (pid ${snap.pid ?? '?'}).`);
				} else if (snap.status === 'external') {
					new Notice(`ReWrite: detected external whisper-server on ${snap.baseUrl}. Transcription will use it; ReWrite won't stop it.`);
				}
			}).catch((e) => { console.error('ReWrite: whisper-host probe failed', e); });
		}
		this.addSettingTab(new ReWriteSettingTab(this.app, this));

		this.addRibbonIcon('mic', 'ReWrite', () => {
			this.openModal();
		});

		this.addCommand({
			id: 'open-modal',
			name: 'Open',
			callback: () => {
				this.openModal();
			},
		});

		this.addCommand({
			id: 'quick-record',
			name: 'Quick record (last used)',
			callback: () => {
				void this.toggleQuickRecord();
			},
		});

		this.addCommand({
			id: 'quick-record-fixed',
			name: 'Quick record (set template)',
			callback: () => {
				void this.toggleQuickRecord({ fixed: true });
			},
		});

		this.addCommand({
			id: 'process-text',
			name: 'Process text with template',
			callback: () => {
				this.processTextWithTemplate();
			},
		});

		this.addCommand({
			id: 'reprocess-audio',
			name: 'Reprocess audio file with template',
			callback: () => {
				this.reprocessAudioFile();
			},
		});

		this.addCommand({
			id: 'start-whisper-host',
			name: 'Start local whisper.cpp server',
			checkCallback: (checking) => {
				if (!Platform.isDesktop) return false;
				if (resolveActiveProfile(this.settings).profile.transcriptionProvider !== 'whisper-local') return false;
				const status = this.whisperHost.status();
				if (status !== 'stopped' && status !== 'crashed') return false;
				if (!checking) {
					void this.startWhisperHost();
				}
				return true;
			},
		});

		this.addCommand({
			id: 'stop-whisper-host',
			name: 'Stop local whisper.cpp server',
			checkCallback: (checking) => {
				if (!Platform.isDesktop) return false;
				const status = this.whisperHost.status();
				// Don't offer Stop for 'external'; ReWrite never kills processes it didn't start.
				if (status !== 'running' && status !== 'starting') return false;
				if (!checking) {
					void this.stopWhisperHost();
				}
				return true;
			},
		});

		if (Platform.isDesktop) {
			const statusBar = new WhisperStatusBar(this, this.addStatusBarItem());
			statusBar.start();
		}

		this.registerEvent(this.app.workspace.on('editor-menu', (menu, editor, info) => {
			menu.addItem((item) => {
				item.setTitle('ReWrite with template...');
				item.setIcon('mic');
				item.onClick(() => {
					this.processTextWithTemplate(resolveTextFromEditor(editor));
				});
			});
			const audioUnderCursor = this.findAudioEmbedUnderCursor(editor, info);
			if (audioUnderCursor) {
				menu.addItem((item) => {
					item.setTitle('Reprocess audio with template...');
					item.setIcon('mic');
					item.onClick(() => {
						this.openTemplatePickerForAudio(audioUnderCursor);
					});
				});
			}
		}));

		this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
			if (!isAudioFile(file)) return;
			menu.addItem((item) => {
				item.setTitle('Reprocess audio with template...');
				item.setIcon('mic');
				item.onClick(() => {
					this.openTemplatePickerForAudio(file);
				});
			});
		}));

		this.registerEvent(this.app.vault.on('create', (file) => this.onVaultFileChanged(file.path)));
		this.registerEvent(this.app.vault.on('modify', (file) => this.onVaultFileChanged(file.path)));
		this.registerEvent(this.app.vault.on('delete', (file) => this.onVaultFileChanged(file.path)));
		this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
			this.onVaultFileChanged(file.path);
			this.onVaultFileChanged(oldPath);
		}));

		this.app.workspace.onLayoutReady(() => {
			void this.refreshTemplates();
			void this.refreshSharedCore();
			void this.refreshAssistantPrompt();
			void this.refreshKnownNouns();
		});
	}

	onunload(): void {
		this.activeQuickRecord?.cancel();
		this.activeQuickRecord = null;
		void this.whisperHost?.stop();
		for (const handle of Object.values(this.pendingRefresh)) {
			if (handle !== undefined) window.clearTimeout(handle);
		}
		this.pendingRefresh = {};
	}

	async saveSettings(): Promise<void> {
		await saveSettings(this, this.settings);
	}

	async refreshEncryptionStatus(): Promise<EncryptionStatus> {
		this.encryptionStatus = await getEncryptionStatus(this);
		return this.encryptionStatus;
	}

	onSecretsUnlocked(cb: () => void): () => void {
		this.unlockListeners.add(cb);
		return () => this.unlockListeners.delete(cb);
	}

	notifySecretsUnlocked(): void {
		for (const cb of this.unlockListeners) {
			try { cb(); } catch (e) { console.error('ReWrite: secrets-unlocked listener failed', e); }
		}
	}

	promptUnlock(onUnlocked?: () => void): void {
		// Unconfigured passphrase mode (no keychain device, first run) reports
		// locked === true but has no passphrase yet: prompt to CREATE one rather
		// than unlock. Configured-but-locked takes the unlock path.
		if (!this.encryptionStatus.configured) {
			new PassphraseModal({
				app: this.app,
				title: 'Set a passphrase',
				description: 'No OS keychain is available on this device, so your API keys are encrypted with a passphrase you set. Store it in your password manager; there is no recovery if you forget it.',
				confirmLabel: 'Save',
				requireConfirm: true,
				enforceStrength: true,
				onSubmit: async (pass) => {
					await setEncryptionMode(this, 'passphrase', pass);
					await hydrateSecrets(this, this.settings);
					await this.refreshEncryptionStatus();
					this.notifySecretsUnlocked();
					onUnlocked?.();
					new Notice('ReWrite: passphrase set. API keys are now encrypted.');
				},
			}).open();
			return;
		}
		new PassphraseModal({
			app: this.app,
			title: 'Unlock API keys',
			description: 'Enter your passphrase to decrypt the API keys stored on this device.',
			confirmLabel: 'Unlock',
			onSubmit: async (pass) => {
				const ok = await unlockSecrets(this, pass);
				if (!ok) throw new Error('Incorrect passphrase.');
				await hydrateSecrets(this, this.settings);
				await this.refreshEncryptionStatus();
				this.notifySecretsUnlocked();
				onUnlocked?.();
				new Notice('ReWrite: API keys unlocked.');
			},
		}).open();
	}

	// Each bumps its generation counter before awaiting the load and only applies the result if
	// the counter is still current, so an in-flight reload superseded by a newer one (concurrent
	// direct call + debounced vault-event call, or two vault events close together) cannot
	// overwrite fresher state with stale data.
	async refreshTemplates(): Promise<void> {
		const gen = ++this.templatesGen;
		const templates = await loadTemplatesFromFolder(this.app, this.settings.templatesFolderPath);
		if (gen === this.templatesGen) this.templates = templates;
	}

	async refreshSharedCore(): Promise<void> {
		const gen = ++this.sharedCoreGen;
		const sharedCore = await loadSharedCoreFromFile(this.app, this.settings.sharedCorePath);
		if (gen === this.sharedCoreGen) this.sharedCore = sharedCore;
	}

	async refreshAssistantPrompt(): Promise<void> {
		const gen = ++this.assistantPromptGen;
		const assistantPrompt = await loadAssistantPromptFromFile(this.app, this.settings.assistantPromptPath);
		if (gen === this.assistantPromptGen) this.assistantPrompt = assistantPrompt;
	}

	async refreshKnownNouns(): Promise<void> {
		const gen = ++this.knownNounsGen;
		const knownNouns = await loadKnownNounsFromFile(this.app, this.settings.knownNounsPath);
		if (gen === this.knownNounsGen) this.knownNouns = knownNouns;
	}

	// Debounces a vault-event-triggered refresh (a template file autosaving fires several
	// `modify` events in quick succession) by waiting for a quiet period before reloading. Direct
	// callers (e.g. the settings tab's Populate button) call refresh*() straight instead, so they
	// still get an immediate, awaitable reload.
	private debounceRefresh(kind: RefreshKind, fn: () => Promise<void>): void {
		const existing = this.pendingRefresh[kind];
		if (existing !== undefined) window.clearTimeout(existing);
		this.pendingRefresh[kind] = window.setTimeout(() => {
			this.pendingRefresh[kind] = undefined;
			void fn();
		}, 250);
	}

	private onVaultFileChanged(path: string): void {
		if (this.isInTemplatesFolder(path)) {
			this.debounceRefresh('templates', () => this.refreshTemplates());
		}
		if (isPathSharedCore(path, this.settings.sharedCorePath)) {
			this.debounceRefresh('sharedCore', () => this.refreshSharedCore());
		}
		if (isPathAssistantPrompt(path, this.settings.assistantPromptPath)) {
			this.debounceRefresh('assistantPrompt', () => this.refreshAssistantPrompt());
		}
		if (isPathKnownNouns(path, this.settings.knownNounsPath)) {
			this.debounceRefresh('knownNouns', () => this.refreshKnownNouns());
		}
	}

	private isInTemplatesFolder(path: string): boolean {
		return isPathInTemplatesFolder(path, this.settings.templatesFolderPath);
	}

	private openModal(): void {
		new ReWriteModal(this.app, this).open();
	}

	private async startWhisperHost(): Promise<void> {
		try {
			await this.whisperHost.start(this.settings.localWhisper);
		} catch (e) {
			console.error('ReWrite: whisper-host start failed', e);
			new Notice(e instanceof Error ? e.message : String(e));
		}
	}

	private async stopWhisperHost(): Promise<void> {
		try {
			await this.whisperHost.stop();
		} catch (e) {
			console.error('ReWrite: whisper-host stop failed', e);
			new Notice(e instanceof Error ? e.message : String(e));
		}
	}

	private async toggleQuickRecord(opts?: { fixed?: boolean }): Promise<void> {
		if (this.activeQuickRecord) {
			await this.activeQuickRecord.finish();
			return;
		}
		if (this.quickRecordStarting) return;
		const commandId = `${this.manifest.id}:${opts?.fixed ? 'quick-record-fixed' : 'quick-record'}`;
		let template: NoteTemplate | undefined;
		if (opts?.fixed) {
			template = this.templates.find((t) => t.id === this.settings.quickRecordTemplateId);
			if (!template) {
				new Notice('ReWrite: choose a quick record template in settings.');
				return;
			}
		}
		this.quickRecordStarting = true;
		try {
			this.activeQuickRecord = await startQuickRecord(this, () => {
				this.activeQuickRecord = null;
			}, { template, commandId });
		} finally {
			this.quickRecordStarting = false;
		}
	}

	private processTextWithTemplate(preResolved?: TextResolution): void {
		const source = preResolved ?? resolveActiveTextSource(this.app);
		if (!source) {
			new Notice('Open a Markdown note or select text to use this command.');
			return;
		}
		if (!source.text.trim()) {
			new Notice('Source text is empty.');
			return;
		}
		if (this.templates.length === 0) {
			new Notice('Add a template in settings first.');
			return;
		}
		const previewText = source.scope === 'selection'
			? `Selection: ${source.text.length.toLocaleString()} chars`
			: `Whole note: ${source.text.length.toLocaleString()} chars`;
		new TemplatePickerModal({
			app: this.app,
			templates: this.templates,
			defaultTemplateId: pickDefaultTemplateId(this.settings, this.templates),
			previewText,
			onPick: (template) => {
				void runTextPipeline(this, template, source.text);
			},
		}).open();
	}

	private reprocessAudioFile(preSelected?: TFile): void {
		if (this.templates.length === 0) {
			new Notice('Add a template in settings first.');
			return;
		}
		if (preSelected) {
			this.openTemplatePickerForAudio(preSelected);
			return;
		}
		const files = collectAudioFiles(this.app);
		if (files.length === 0) {
			new Notice('No audio files found in this vault.');
			return;
		}
		new AudioFilePickerModal({
			app: this.app,
			files,
			onPick: (file) => {
				this.openTemplatePickerForAudio(file);
			},
		}).open();
	}

	private openTemplatePickerForAudio(file: TFile): void {
		if (this.templates.length === 0) {
			new Notice('Add a template in settings first.');
			return;
		}
		new TemplatePickerModal({
			app: this.app,
			templates: this.templates,
			defaultTemplateId: pickDefaultTemplateId(this.settings, this.templates),
			previewText: `Audio: ${file.path}`,
			showContext: this.templates.some((t) => t.enableContextHint),
			onPick: (template, contextHint) => {
				void runAudioFilePipeline(this, template, file, template.enableContextHint ? contextHint : undefined);
			},
		}).open();
	}

	private findAudioEmbedUnderCursor(editor: Editor, info: MarkdownView | MarkdownFileInfo): TFile | null {
		const cursor = editor.getCursor();
		const line = editor.getLine(cursor.line);
		const re = /!\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g;
		const sourcePath = info.file?.path ?? '';
		let match: RegExpExecArray | null;
		while ((match = re.exec(line)) !== null) {
			const start = match.index;
			const end = start + match[0].length;
			if (cursor.ch < start || cursor.ch > end) continue;
			const linkpath = match[1]?.trim();
			if (!linkpath) continue;
			const resolved = this.app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
			if (isAudioFile(resolved)) return resolved;
		}
		return null;
	}

}
