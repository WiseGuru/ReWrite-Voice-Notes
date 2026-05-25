import { App, Modal, Notice } from 'obsidian';
import type ReWritePlugin from '../main';
import { runPipeline, PipelineSource, PipelineStage } from '../pipeline';
import { isMediaRecorderAvailable, isWebSpeechAvailable, resolveActiveProfile } from '../platform';
import { Recorder } from '../recorder';
import { startWebSpeech, WebSpeechSession } from '../webspeech';
import { EnvironmentProfile } from '../types';
import { isProfileConfigured, isProfileConfiguredForText, renderSetupCard } from './setup-card';
import { resolveActiveTextSource } from './text-source';

export class ReWriteModal extends Modal {
	private templateId: string;
	private activeTab: 'record' | 'paste' | 'fromNote' = 'record';
	private recorder: Recorder | null = null;
	private webSpeech: WebSpeechSession | null = null;
	private timerHandle: number | null = null;
	private running = false;
	private currentSource: PipelineSource | null = null;

	constructor(
		app: App,
		private readonly plugin: ReWritePlugin,
		initialTemplateId?: string,
	) {
		super(app);
		this.templateId = initialTemplateId ?? this.pickDefaultTemplateId();
	}

	onOpen(): void {
		this.modalEl.addClass('rewrite-modal');
		this.render();
	}

	onClose(): void {
		this.releaseCapture();
		this.contentEl.empty();
	}

	private pickDefaultTemplateId(): string {
		const s = this.plugin.settings;
		if (s.lastUsedTemplateId && s.templates.some((t) => t.id === s.lastUsedTemplateId)) {
			return s.lastUsedTemplateId;
		}
		if (s.defaultTemplateId && s.templates.some((t) => t.id === s.defaultTemplateId)) {
			return s.defaultTemplateId;
		}
		return s.templates[0]?.id ?? '';
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: 'ReWrite' });

		const { kind, profile } = resolveActiveProfile(this.plugin.settings);
		const profileLabel = kind === 'desktop' ? 'Desktop' : 'Mobile';

		if (this.plugin.settings.templates.length === 0) {
			contentEl.createEl('p', {
				text: 'No templates are configured. Open settings to add one.',
			});
			const btn = contentEl.createEl('button', { text: 'Open settings' });
			btn.addEventListener('click', () => {
				this.close();
				this.openSettingsTab();
			});
			return;
		}

		this.renderTemplateSelector(contentEl);
		this.renderTabBar(contentEl);
		const tabBody = contentEl.createDiv({ cls: 'rewrite-tab-body' });

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
			this.renderRecordTab(tabBody, profile.transcriptionProvider === 'webspeech', profile.transcriptionConfig.language);
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

	private renderTemplateSelector(parent: HTMLElement): void {
		const wrap = parent.createDiv({ cls: 'rewrite-template-row' });
		wrap.createEl('label', { text: 'Template' });
		const select = wrap.createEl('select');
		const ids = this.plugin.settings.templates.map((t) => t.id);
		if (!ids.includes(this.templateId)) {
			this.templateId = ids[0] ?? '';
		}
		for (const t of this.plugin.settings.templates) {
			const opt = select.createEl('option', { text: t.name });
			opt.value = t.id;
			if (t.id === this.templateId) opt.selected = true;
		}
		select.addEventListener('change', () => {
			this.templateId = select.value;
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
		record.addEventListener('click', () => {
			this.activeTab = 'record';
			this.render();
		});
		paste.addEventListener('click', () => {
			this.activeTab = 'paste';
			this.render();
		});
		fromNote.addEventListener('click', () => {
			this.activeTab = 'fromNote';
			this.render();
		});
	}

	private renderRecordTab(parent: HTMLElement, isWebSpeech: boolean, language: string): void {
		if (isWebSpeech && !isWebSpeechAvailable()) {
			parent.createEl('p', {
				text: 'Web Speech is not available here. Use the paste tab or pick a different transcription provider in settings.',
			});
			return;
		}
		if (!isWebSpeech && !isMediaRecorderAvailable()) {
			parent.createEl('p', {
				text: 'Audio recording is not supported in this environment. Use the paste tab instead.',
			});
			return;
		}

		const button = parent.createEl('button', {
			text: 'Record',
			cls: 'mod-cta rewrite-record-button',
		});
		const indicator = parent.createDiv({ cls: 'rewrite-recording-indicator' });
		const dot = indicator.createSpan({ cls: 'rewrite-pulse-dot' });
		dot.hide();
		const timer = indicator.createSpan({ cls: 'rewrite-timer', text: '0:00' });
		const liveTranscript = parent.createDiv({ cls: 'rewrite-live-transcript' });

		let isRecording = false;
		const handleClick = async (): Promise<void> => {
			if (this.running) return;
			if (!isRecording) {
				try {
					await this.beginCapture(isWebSpeech, language, (text) => {
						liveTranscript.setText(text);
					});
				} catch (e) {
					new Notice(e instanceof Error ? e.message : String(e));
					return;
				}
				isRecording = true;
				button.setText('Stop');
				dot.show();
				this.startTimerLoop(timer, isWebSpeech);
			} else {
				button.disabled = true;
				try {
					const source = await this.endCapture(isWebSpeech);
					isRecording = false;
					button.setText('Record');
					dot.hide();
					this.stopTimerLoop();
					await this.execute(source);
				} catch (e) {
					new Notice(e instanceof Error ? e.message : String(e));
					isRecording = false;
					button.setText('Record');
					dot.hide();
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
		textarea.rows = 10;
		const button = parent.createEl('button', { text: 'Clean up', cls: 'mod-cta' });
		button.addEventListener('click', () => {
			const text = textarea.value.trim();
			if (!text) {
				new Notice('Paste some text first.');
				return;
			}
			void this.execute({ kind: 'paste', text });
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
			void this.execute({ kind: 'text', text: fresh.text });
		});
	}

	private async beginCapture(
		isWebSpeech: boolean,
		language: string,
		onLiveText: (text: string) => void,
	): Promise<void> {
		if (isWebSpeech) {
			this.webSpeech = startWebSpeech({
				language: language || undefined,
				onUpdate: onLiveText,
			});
		} else {
			this.recorder = new Recorder();
			await this.recorder.start(this.plugin.settings.recordingFormat);
		}
	}

	private async endCapture(isWebSpeech: boolean): Promise<PipelineSource> {
		if (isWebSpeech) {
			const transcript = (await this.webSpeech?.stop()) ?? '';
			this.webSpeech = null;
			return { kind: 'webspeech', transcript };
		}
		if (!this.recorder) throw new Error('No active recording.');
		const result = await this.recorder.stop();
		this.recorder = null;
		return { kind: 'audio', audio: result.blob };
	}

	private startTimerLoop(timerEl: HTMLElement, isWebSpeech: boolean): void {
		const startedAt = Date.now();
		this.timerHandle = window.setInterval(() => {
			const ms = isWebSpeech ? Date.now() - startedAt : this.recorder?.getElapsedMs() ?? 0;
			timerEl.setText(formatDuration(ms));
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
		this.webSpeech?.cancel();
		this.webSpeech = null;
	}

	private async execute(source: PipelineSource): Promise<void> {
		const template = this.plugin.settings.templates.find((t) => t.id === this.templateId);
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
				profile,
				template,
				source,
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

function stageLabel(stage: PipelineStage): string {
	switch (stage) {
		case 'transcribe':
			return 'Transcribing...';
		case 'cleanup':
			return 'Cleaning up...';
		case 'insert':
			return 'Inserting...';
	}
}

function formatDuration(ms: number): string {
	const total = Math.max(0, Math.floor(ms / 1000));
	const minutes = Math.floor(total / 60);
	const seconds = total % 60;
	return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
