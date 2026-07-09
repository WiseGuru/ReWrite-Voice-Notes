import { App, Modal, Notice, Platform } from 'obsidian';
import type ReWritePlugin from '../main';
import { runPipeline, PipelineSource } from '../pipeline';
import { isMediaRecorderAvailable, resolveActiveProfile } from '../platform';
import { Recorder } from '../recorder';
import { DestinationOverride, EnvironmentProfile, InsertMode, NoteTemplate } from '../types';
import { isProfileConfigured, isProfileConfiguredForText, renderSetupCard } from './setup-card';
import { resolveActiveTextSource } from './text-source';
import { formatDuration, runBackgroundPipeline, stageLabel } from './pipeline-progress';
import { pickDefaultTemplateId } from '../templates-folder';
import { transcriptionProviderSupportsDiarization } from '../transcription';

// Continuous silence (ms) before the Record UI warns about a muted / dead mic.
const SILENCE_WARNING_MS = 3000;
const SILENCE_WARNING_TEXT = 'No audio detected. Check that your microphone is on and not muted.';
// Shown on mobile for the duration of a recording: backgrounding the app suspends the
// Capacitor WebView, which stops MediaRecorder mid-capture (the screen wake lock prevents
// screen-sleep but cannot prevent an app switch).
const MOBILE_RECORD_WARNING_TEXT = 'Keep Obsidian in the foreground while recording. Switching to another app stops the capture and the recording may be lost.';

export class ReWriteModal extends Modal {
	private templateId: string;
	private activeTab: 'record' | 'paste' | 'fromNote' = 'record';
	private recorder: Recorder | null = null;
	private timerHandle: number | null = null;
	private running = false;
	// Hoisted from the old renderRecordTab closure local: a mid-recording render() (tab
	// switch, template change, destination edit) used to rebuild the record tab with a
	// fresh "Record" button while the old recorder/timer kept running with no way to stop
	// them. Tab bar / template select / destination controls are now disabled while this
	// (or `running`) is true, and the recording survives re-renders since it lives on the
	// instance rather than a tab-local closure.
	private isRecording = false;
	private currentSource: PipelineSource | null = null;
	private destinationOverride: DestinationOverride | null = null;
	private destinationExpanded = false;
	private contextHint = '';
	private contextExpanded = false;
	// Per-invocation speaker-diarization choice. Defaults to the active template's `diarize`
	// flag (reset on template change), and the user can toggle it for this run. There is no
	// persisted profile setting anymore.
	private diarize = false;

	constructor(
		app: App,
		private readonly plugin: ReWritePlugin,
		initialTemplateId?: string,
	) {
		super(app);
		this.templateId = initialTemplateId ?? pickDefaultTemplateId(this.plugin.settings, this.plugin.templates);
		this.diarize = !!this.activeTemplate()?.diarize;
	}

	onOpen(): void {
		this.modalEl.addClass('rewrite-modal');
		this.render();
	}

	onClose(): void {
		this.releaseCapture();
		this.contentEl.empty();
	}

	// While a recording is in progress or a pipeline is running, template/destination/tab
	// controls that would call render() must be disabled: a mid-flight render() would
	// rebuild the tab body and orphan the recorder or the in-flight execute() progress UI.
	private isLocked(): boolean {
		return this.isRecording || this.running;
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: 'ReWrite' });

		const { kind, profile } = resolveActiveProfile(this.plugin.settings);
		const profileLabel = kind === 'desktop' ? 'Desktop' : 'Mobile';

		if (this.plugin.templates.length === 0) {
			contentEl.createEl('p', {
				text: 'No templates are configured. Open settings to set up your templates folder.',
			});
			const btn = contentEl.createEl('button', { text: 'Open settings' });
			btn.addEventListener('click', () => {
				this.close();
				this.openSettingsTab();
			});
			return;
		}

		this.renderTemplateSelector(contentEl);
		this.renderDestinationSelector(contentEl);
		this.renderContextSelector(contentEl);
		this.renderDiarizeToggle(contentEl);
		this.renderTabBar(contentEl);
		const tabBody = contentEl.createDiv({ cls: 'rewrite-tab-body' });

		if (this.plugin.encryptionStatus.locked) {
			this.renderLockedBanner(tabBody);
			return;
		}

		if (this.activeTab === 'fromNote') {
			if (!isProfileConfiguredForText(profile)) {
				this.renderSetupCardInTab(tabBody, profile, profileLabel, 'text');
				return;
			}
			this.renderFromNoteTab(tabBody);
			return;
		}

		if (!isProfileConfigured(profile)) {
			this.renderSetupCardInTab(tabBody, profile, profileLabel, 'voice');
			return;
		}

		if (this.activeTab === 'record') {
			if (profile.transcriptionProvider === 'none') {
				tabBody.createEl('p', {
					text: 'Recording is disabled because this profile has no transcription provider configured. Switch to one of the other tabs above, or pick a transcription provider in settings.',
				});
				return;
			}
			this.renderRecordTab(tabBody);
		} else {
			this.renderPasteTab(tabBody);
		}
	}

	private renderSetupCardInTab(
		parent: HTMLElement,
		profile: EnvironmentProfile,
		profileLabel: string,
		purpose: 'voice' | 'text',
	): void {
		renderSetupCard({
			container: parent,
			profile,
			profileLabel,
			purpose,
			onSaved: async () => {
				await this.plugin.saveSettings();
				this.render();
			},
			onOpenSettings: () => {
				this.close();
				this.openSettingsTab();
			},
		});
	}

	private renderLockedBanner(parent: HTMLElement): void {
		const card = parent.createDiv({ cls: 'rewrite-setup-card rewrite-locked-card' });
		card.createEl('h3', { text: 'API keys are locked' });
		card.createEl('p', {
			text: 'Your API keys are encrypted with a passphrase. Unlock them to record or process text.',
		});
		const actions = card.createDiv({ cls: 'rewrite-setup-actions' });
		const unlockBtn = actions.createEl('button', { text: 'Unlock', cls: 'mod-cta' });
		unlockBtn.addEventListener('click', () => {
			this.plugin.promptUnlock(() => this.render());
		});
		const settingsBtn = actions.createEl('button', { text: 'Open settings' });
		settingsBtn.addEventListener('click', () => {
			this.close();
			this.openSettingsTab();
		});
	}

	private renderTemplateSelector(parent: HTMLElement): void {
		const wrap = parent.createDiv({ cls: 'rewrite-template-row' });
		wrap.createEl('label', { text: 'Template' });
		const select = wrap.createEl('select');
		const ids = this.plugin.templates.map((t) => t.id);
		if (!ids.includes(this.templateId)) {
			this.templateId = ids[0] ?? '';
		}
		for (const t of this.plugin.templates) {
			const opt = select.createEl('option', { text: t.name });
			opt.value = t.id;
			if (t.id === this.templateId) opt.selected = true;
		}
		select.disabled = this.isLocked();
		select.addEventListener('change', () => {
			if (this.isLocked()) return;
			this.templateId = select.value;
			this.destinationOverride = null;
			this.destinationExpanded = false;
			this.contextHint = '';
			this.contextExpanded = false;
			this.diarize = !!this.activeTemplate()?.diarize;
			this.render();
		});
	}

	private renderDestinationSelector(parent: HTMLElement): void {
		const template = this.activeTemplate();
		if (!template) return;
		const effectiveMode = this.destinationOverride?.insertMode ?? template.insertMode;
		const effectiveFolder = this.destinationOverride?.newFileFolder ?? template.newFileFolder;
		const effectiveName = this.destinationOverride?.newFileNameTemplate ?? template.newFileNameTemplate;
		const hasOverride = this.destinationOverride !== null;

		const details = parent.createEl('details', { cls: 'rewrite-destination-row' });
		details.open = this.destinationExpanded || hasOverride;
		details.addEventListener('toggle', () => {
			this.destinationExpanded = details.open;
		});

		const summary = details.createEl('summary', { cls: 'rewrite-destination-summary' });
		const summaryQualifier = hasOverride ? 'Custom' : 'Default';
		summary.createSpan({ cls: 'rewrite-destination-summary-label', text: 'Destination: ' });
		summary.createSpan({
			cls: 'rewrite-destination-summary-value',
			text: `${summaryQualifier} (${describeDestination(effectiveMode, effectiveFolder, effectiveName)})`,
		});

		const body = details.createDiv({ cls: 'rewrite-destination-body' });
		const select = body.createEl('select');
		const modes: Array<{ id: InsertMode; label: string }> = [
			{ id: 'cursor', label: 'Cursor (active editor)' },
			{ id: 'newFile', label: 'New file' },
			{ id: 'append', label: 'Append to active note' },
		];
		for (const m of modes) {
			const opt = select.createEl('option', { text: m.label });
			opt.value = m.id;
			if (m.id === effectiveMode) opt.selected = true;
		}
		const locked = this.isLocked();
		select.disabled = locked;
		select.addEventListener('change', () => {
			if (this.isLocked()) return;
			this.setDestinationOverride({ insertMode: select.value as InsertMode });
			this.destinationExpanded = true;
			this.render();
		});

		if (effectiveMode === 'newFile') {
			const folderLabel = body.createEl('label', { text: 'Folder', cls: 'rewrite-destination-sublabel' });
			const folderInput = folderLabel.createEl('input', { type: 'text' });
			folderInput.value = effectiveFolder;
			folderInput.placeholder = '(vault root)';
			folderInput.disabled = locked;
			folderInput.addEventListener('change', () => {
				this.setDestinationOverride({ newFileFolder: folderInput.value });
			});

			const nameLabel = body.createEl('label', { text: 'Filename template', cls: 'rewrite-destination-sublabel' });
			const nameInput = nameLabel.createEl('input', { type: 'text' });
			nameInput.value = effectiveName;
			nameInput.placeholder = 'ReWrite {{date}} {{time}}';
			nameInput.disabled = locked;
			nameInput.addEventListener('change', () => {
				this.setDestinationOverride({ newFileNameTemplate: nameInput.value });
			});
		}

		if (this.destinationOverride) {
			const reset = body.createEl('button', { text: 'Reset to template default', cls: 'rewrite-destination-reset' });
			reset.disabled = locked;
			reset.addEventListener('click', () => {
				if (this.isLocked()) return;
				this.destinationOverride = null;
				this.destinationExpanded = false;
				this.render();
			});
		}
	}

	private activeTemplate(): NoteTemplate | undefined {
		return this.plugin.templates.find((t) => t.id === this.templateId);
	}

	private setDestinationOverride(patch: DestinationOverride): void {
		const template = this.activeTemplate();
		if (!template) return;
		const current: DestinationOverride = this.destinationOverride ?? {
			insertMode: template.insertMode,
			newFileFolder: template.newFileFolder,
			newFileNameTemplate: template.newFileNameTemplate,
		};
		this.destinationOverride = {
			insertMode: patch.insertMode ?? current.insertMode,
			newFileFolder: patch.newFileFolder ?? current.newFileFolder,
			newFileNameTemplate: patch.newFileNameTemplate ?? current.newFileNameTemplate,
		};
	}

	private renderContextSelector(parent: HTMLElement): void {
		const template = this.activeTemplate();
		if (!template?.enableContextHint) return;

		const details = parent.createEl('details', { cls: 'rewrite-context-row' });
		details.open = this.contextExpanded;
		details.addEventListener('toggle', () => {
			this.contextExpanded = details.open;
		});

		const summary = details.createEl('summary', { cls: 'rewrite-context-summary' });
		summary.createSpan({ cls: 'rewrite-context-summary-label', text: 'Context: ' });
		summary.createSpan({
			cls: 'rewrite-context-summary-value',
			text: this.contextHint.trim() ? 'Set' : 'None (optional)',
		});

		const body = details.createDiv({ cls: 'rewrite-context-body' });
		const textarea = body.createEl('textarea', { cls: 'rewrite-context-input' });
		textarea.rows = Platform.isMobile ? 2 : 3;
		textarea.placeholder = 'Who is speaking and what this recording is (for example a lecture by one professor, or a meeting with several teammates)';
		textarea.value = this.contextHint;
		textarea.addEventListener('input', () => {
			this.contextHint = textarea.value;
		});
	}

	// Per-invocation "Identify speakers" toggle, shown only when the active profile's
	// transcription provider supports diarization. Defaults to the template's `diarize`
	// flag; the user can override it for this run. Only affects audio transcription.
	private renderDiarizeToggle(parent: HTMLElement): void {
		const { profile } = resolveActiveProfile(this.plugin.settings);
		if (!transcriptionProviderSupportsDiarization(profile.transcriptionProvider)) return;

		const row = parent.createDiv({ cls: 'rewrite-diarize-row' });
		const label = row.createEl('label', { cls: 'rewrite-diarize-label' });
		const checkbox = label.createEl('input', { type: 'checkbox' });
		checkbox.checked = this.diarize;
		checkbox.disabled = this.isLocked();
		label.createSpan({
			text: 'Identify speakers (label each voice; good for meetings, off for daily notes)',
		});
		checkbox.addEventListener('change', () => {
			if (this.isLocked()) {
				checkbox.checked = this.diarize;
				return;
			}
			this.diarize = checkbox.checked;
		});
	}

	private renderTabBar(parent: HTMLElement): void {
		const tabs = parent.createDiv({ cls: 'rewrite-tabs' });
		const record = tabs.createEl('button', { text: 'Record', cls: 'rewrite-tab' });
		const paste = tabs.createEl('button', { text: 'Paste', cls: 'rewrite-tab' });
		const fromNote = tabs.createEl('button', { text: 'From note', cls: 'rewrite-tab' });
		if (this.activeTab === 'record') record.addClass('is-active');
		else if (this.activeTab === 'paste') paste.addClass('is-active');
		else fromNote.addClass('is-active');
		const locked = this.isLocked();
		record.disabled = locked;
		paste.disabled = locked;
		fromNote.disabled = locked;
		record.addEventListener('click', () => {
			if (this.isLocked()) return;
			this.activeTab = 'record';
			this.render();
		});
		paste.addEventListener('click', () => {
			if (this.isLocked()) return;
			this.activeTab = 'paste';
			this.render();
		});
		fromNote.addEventListener('click', () => {
			if (this.isLocked()) return;
			this.activeTab = 'fromNote';
			this.render();
		});
	}

	private renderRecordTab(parent: HTMLElement): void {
		if (!isMediaRecorderAvailable()) {
			parent.createEl('p', {
				text: 'Audio recording is not supported in this environment. Use the paste tab instead.',
			});
			return;
		}

		// Desktop-only opt-in (persisted on GlobalSettings.recordInBackground):
		// pressing Record hands capture off to the Quick Record floating UI with
		// this modal's template / destination override / context hint, closing the
		// modal so Obsidian stays usable during capture. Hidden on mobile, where
		// backgrounded capture is unreliable (the WebView suspends MediaRecorder).
		if (Platform.isDesktop) {
			const label = parent.createEl('label', { cls: 'rewrite-background-record' });
			const checkbox = label.createEl('input', { type: 'checkbox' });
			checkbox.checked = this.plugin.settings.recordInBackground;
			checkbox.disabled = this.isLocked();
			label.createSpan({
				text: 'Record in background (close this window and keep recording in a floating bar)',
			});
			checkbox.addEventListener('change', () => {
				this.plugin.settings.recordInBackground = checkbox.checked;
				void this.plugin.saveSettings().catch((e) => {
					console.error('ReWrite: failed to save record-in-background setting', e);
				});
			});
		}

		const button = parent.createEl('button', {
			text: 'Record',
			cls: 'mod-cta rewrite-record-button',
		});
		const indicator = parent.createDiv({ cls: 'rewrite-recording-indicator' });
		const dot = indicator.createSpan({ cls: 'rewrite-pulse-dot' });
		dot.hide();
		const timer = indicator.createSpan({ cls: 'rewrite-timer', text: '0:00' });
		const warning = parent.createDiv({
			cls: 'rewrite-silence-warning',
			text: SILENCE_WARNING_TEXT,
		});
		warning.hide();
		// Mobile-only: warn not to leave the app while recording. Shown for the whole capture
		// (not tied to silence), hidden when idle.
		const mobileWarning = Platform.isMobile
			? parent.createDiv({ cls: 'rewrite-mobile-record-warning', text: MOBILE_RECORD_WARNING_TEXT })
			: null;
		mobileWarning?.hide();

		// isRecording is hoisted onto the instance (this.isRecording) rather than kept as a tab-local
		// closure variable so it survives a render() the instant one is disallowed to fire: tab bar,
		// template select, and destination controls are disabled via isLocked() for as long as it (or
		// this.running) is true, so this record button is the only interactive control left.
		const handleClick = async (): Promise<void> => {
			// Only guard on a pipeline being in flight, not on isRecording: this button is what
			// toggles isRecording, so gating on isLocked() here would make Stop unreachable the
			// moment recording starts (isLocked() is true precisely because isRecording is true).
			if (this.running) return;
			if (!this.isRecording) {
				if (Platform.isDesktop && this.plugin.settings.recordInBackground) {
					this.startBackgroundHandoff();
					return;
				}
				try {
					await this.beginCapture();
				} catch (e) {
					new Notice(e instanceof Error ? e.message : String(e));
					return;
				}
				this.isRecording = true;
				button.setText('Stop');
				dot.show();
				mobileWarning?.show();
				this.startTimerLoop(timer, warning);
			} else {
				button.disabled = true;
				try {
					const source = await this.endCapture();
					this.isRecording = false;
					button.setText('Record');
					dot.hide();
					warning.hide();
					mobileWarning?.hide();
					this.stopTimerLoop();
					this.startRecordingPipeline(source);
				} catch (e) {
					new Notice(e instanceof Error ? e.message : String(e));
					this.isRecording = false;
					button.setText('Record');
					dot.hide();
					warning.hide();
					mobileWarning?.hide();
					this.stopTimerLoop();
				} finally {
					button.disabled = false;
				}
			}
		};
		button.addEventListener('click', () => {
			void handleClick();
		});
	}

	private renderPasteTab(parent: HTMLElement): void {
		const textarea = parent.createEl('textarea', { cls: 'rewrite-paste' });
		// Fewer rows on mobile so the submit button stays above the soft keyboard.
		textarea.rows = Platform.isMobile ? 4 : 10;
		const button = parent.createEl('button', { text: 'Clean up', cls: 'mod-cta' });
		button.addEventListener('click', () => {
			if (this.running) return;
			const text = textarea.value.trim();
			if (!text) {
				new Notice('Paste some text first.');
				return;
			}
			button.disabled = true;
			void this.execute({ kind: 'paste', text }).finally(() => { button.disabled = false; });
		});
		textarea.focus();
	}

	private renderFromNoteTab(parent: HTMLElement): void {
		const previewEl = parent.createEl('p', { cls: 'rewrite-from-note-preview' });
		const source = resolveActiveTextSource(this.app);
		if (!source) {
			previewEl.setText('No active Markdown note. Open a note (or select text) to use this.');
		} else if (source.scope === 'selection') {
			previewEl.setText(`Selection: ${source.text.length.toLocaleString()} chars`);
		} else {
			previewEl.setText(`Whole note: ${source.text.length.toLocaleString()} chars`);
		}

		const button = parent.createEl('button', { text: 'Run', cls: 'mod-cta' });
		if (!source) button.disabled = true;
		button.addEventListener('click', () => {
			if (this.running) return;
			const fresh = resolveActiveTextSource(this.app);
			if (!fresh) {
				new Notice('Open a Markdown note or select text first.');
				return;
			}
			const trimmed = fresh.text.trim();
			if (!trimmed) {
				new Notice('Source text is empty.');
				return;
			}
			button.disabled = true;
			void this.execute({ kind: 'text', text: fresh.text }).finally(() => { button.disabled = false; });
		});
	}

	private async beginCapture(): Promise<void> {
		this.recorder = new Recorder();
		await this.recorder.start(this.plugin.settings.recordingFormat);
	}

	private async endCapture(): Promise<PipelineSource> {
		if (!this.recorder) throw new Error('No active recording.');
		const result = await this.recorder.stop();
		this.recorder = null;
		return { kind: 'audio', audio: result.blob, durationMs: result.durationMs };
	}

	private startTimerLoop(timerEl: HTMLElement, warningEl: HTMLElement): void {
		this.timerHandle = window.setInterval(() => {
			const recorder = this.recorder;
			const ms = recorder?.getElapsedMs() ?? 0;
			timerEl.setText(formatDuration(ms));
			const silent = (recorder?.getSilentMs() ?? 0) > SILENCE_WARNING_MS;
			if (silent) warningEl.show();
			else warningEl.hide();
		}, 250);
	}

	private stopTimerLoop(): void {
		if (this.timerHandle !== null) {
			window.clearInterval(this.timerHandle);
			this.timerHandle = null;
		}
	}

	private releaseCapture(): void {
		this.stopTimerLoop();
		this.recorder?.cancel();
		this.recorder = null;
	}

	// "Record in background" path: capture the modal's per-invocation params into
	// locals, close the modal, and hand capture off to the Quick Record floating UI
	// via the plugin's single-owner entry (same activeQuickRecord slot as the two
	// commands, so only one recording can ever be live).
	private startBackgroundHandoff(): void {
		const template = this.activeTemplate();
		if (!template) {
			new Notice('Please pick a template.');
			return;
		}
		const destinationOverride = this.destinationOverride ?? undefined;
		const contextHint = this.contextHint.trim() || undefined;
		const diarize = this.diarize;
		const plugin = this.plugin;
		this.close();
		void plugin.startBackgroundRecording({ template, destinationOverride, contextHint, diarize });
	}

	// Recorded-audio path: close the modal immediately and run the pipeline detached, reporting
	// progress and errors through a Notice (mirrors runAudioFilePipeline). The recording is
	// persisted to the vault before transcription, so the saved file is the recovery path on
	// error; no inline Retry is needed. Paste / From note keep execute()'s in-modal flow because
	// they have no persisted recovery.
	private startRecordingPipeline(source: PipelineSource): void {
		const template = this.activeTemplate();
		if (!template) {
			new Notice('Please pick a template.');
			return;
		}
		const { profile } = resolveActiveProfile(this.plugin.settings);
		const destinationOverride = this.destinationOverride ?? undefined;
		const contextHint = this.contextHint.trim() || undefined;
		const plugin = this.plugin;
		const app = this.app;
		this.close();

		void runBackgroundPipeline(
			plugin,
			{
				app,
				settings: plugin.settings,
				host: plugin,
				profile,
				template,
				source,
				destinationOverride,
				contextHint,
				diarize: this.diarize,
			},
			{ startMessage: 'ReWrite: working...', templateId: template.id },
		);
	}

	private async execute(source: PipelineSource): Promise<void> {
		if (this.running) return;
		const template = this.plugin.templates.find((t) => t.id === this.templateId);
		if (!template) {
			new Notice('Please pick a template.');
			return;
		}
		this.currentSource = source;
		this.running = true;
		const progress = this.contentEl.createDiv({ cls: 'rewrite-progress' });
		progress.setText('Working...');
		const { profile } = resolveActiveProfile(this.plugin.settings);
		try {
			await runPipeline({
				app: this.app,
				settings: this.plugin.settings,
				host: this.plugin,
				profile,
				template,
				source,
				destinationOverride: this.destinationOverride ?? undefined,
				contextHint: this.contextHint.trim() || undefined,
				diarize: this.diarize,
				onStage: (stage) => progress.setText(stageLabel(stage)),
			});
			this.plugin.settings.lastUsedTemplateId = template.id;
			await this.plugin.saveSettings();
			new Notice('ReWrite complete.');
			this.close();
		} catch (e) {
			progress.remove();
			const message = e instanceof Error ? e.message : String(e);
			new Notice(message);
			this.renderRetry(message);
		} finally {
			this.running = false;
		}
	}

	private renderRetry(message: string): void {
		const retry = this.contentEl.createDiv({ cls: 'rewrite-retry' });
		retry.createEl('p', { text: message });
		const button = retry.createEl('button', { text: 'Retry', cls: 'mod-cta' });
		button.addEventListener('click', () => {
			retry.remove();
			if (this.currentSource) {
				void this.execute(this.currentSource);
			}
		});
	}

	private openSettingsTab(): void {
		const setting = (this.app as unknown as {
			setting?: { open(): void; openTabById(id: string): void };
		}).setting;
		if (!setting) return;
		setting.open();
		setting.openTabById(this.plugin.manifest.id);
	}
}

function describeDestination(mode: InsertMode, folder: string, nameTemplate: string): string {
	switch (mode) {
		case 'cursor':
			return 'Cursor (active editor)';
		case 'append':
			return 'Append to active note';
		case 'newFile': {
			const folderPart = folder.trim() || '(vault root)';
			const namePart = nameTemplate.trim() || 'ReWrite {{date}} {{time}}';
			return `New file: ${folderPart}/${namePart}`;
		}
	}
}
