import { Notice } from 'obsidian';
import type ReWritePlugin from '../main';
import { PipelineSource, PipelineStage, runPipeline } from '../pipeline';
import { isMediaRecorderAvailable, isWebSpeechAvailable, resolveActiveProfile } from '../platform';
import { Recorder } from '../recorder';
import { startWebSpeech, WebSpeechSession } from '../webspeech';
import { NoteTemplate } from '../types';
import { isProfileConfigured } from './setup-card';
import { ReWriteModal } from './modal';

export class QuickRecordController {
	private recorder: Recorder | null = null;
	private webSpeech: WebSpeechSession | null = null;
	private timerHandle: number | null = null;
	private floater: QuickRecordFloater | null = null;
	private settled = false;
	private startedAt = 0;
	private template: NoteTemplate;

	constructor(
		private readonly plugin: ReWritePlugin,
		template: NoteTemplate,
		private readonly isWebSpeech: boolean,
		private readonly onDispose: () => void,
	) {
		this.template = template;
	}

	async begin(): Promise<void> {
		const { profile } = resolveActiveProfile(this.plugin.settings);
		if (this.isWebSpeech) {
			this.webSpeech = startWebSpeech({
				language: profile.transcriptionConfig.language || undefined,
			});
		} else {
			this.recorder = new Recorder();
			await this.recorder.start(this.plugin.settings.recordingFormat);
		}
		this.startedAt = Date.now();
		this.floater = new QuickRecordFloater({
			onStop: () => {
				void this.finish();
			},
			onCancel: () => this.cancel(),
			getTemplates: () => this.plugin.templates,
			getActiveTemplateId: () => this.template.id,
			onPickTemplate: (t) => {
				this.template = t;
				this.floater?.setTemplateName(t.name);
			},
			initialTemplateName: this.template.name,
		});
		this.timerHandle = window.setInterval(() => {
			const ms = this.isWebSpeech
				? Date.now() - this.startedAt
				: this.recorder?.getElapsedMs() ?? 0;
			this.floater?.setTime(formatDuration(ms));
		}, 250);
	}

	cancel(): void {
		if (this.settled) return;
		this.settled = true;
		this.stopTimer();
		this.recorder?.cancel();
		this.recorder = null;
		this.webSpeech?.cancel();
		this.webSpeech = null;
		this.floater?.dispose();
		this.floater = null;
		this.onDispose();
	}

	async finish(): Promise<void> {
		if (this.settled) return;
		this.settled = true;
		this.stopTimer();
		this.floater?.setBusy('Processing...');
		try {
			const source = await this.endCapture();
			const { profile } = resolveActiveProfile(this.plugin.settings);
			await runPipeline({
				app: this.plugin.app,
				settings: this.plugin.settings,
				host: this.plugin,
				profile,
				template: this.template,
				source,
				onStage: (stage) => this.floater?.setBusy(stageLabel(stage)),
			});
			this.plugin.settings.lastUsedTemplateId = this.template.id;
			await this.plugin.saveSettings();
			new Notice('ReWrite complete.');
			this.floater?.dispose();
			this.floater = null;
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			new Notice(`ReWrite quick record failed: ${msg}`);
			this.floater?.dispose();
			this.floater = null;
			new ReWriteModal(this.plugin.app, this.plugin).open();
		} finally {
			this.onDispose();
		}
	}

	private async endCapture(): Promise<PipelineSource> {
		if (this.isWebSpeech) {
			const transcript = (await this.webSpeech?.stop()) ?? '';
			this.webSpeech = null;
			return { kind: 'webspeech', transcript };
		}
		if (!this.recorder) throw new Error('No active recording.');
		const result = await this.recorder.stop();
		this.recorder = null;
		return { kind: 'audio', audio: result.blob };
	}

	private stopTimer(): void {
		if (this.timerHandle !== null) {
			window.clearInterval(this.timerHandle);
			this.timerHandle = null;
		}
	}
}

export async function startQuickRecord(
	plugin: ReWritePlugin,
	onDispose: () => void,
): Promise<QuickRecordController | null> {
	const settings = plugin.settings;
	const { profile } = resolveActiveProfile(settings);

	if (plugin.encryptionStatus.locked) {
		new Notice('ReWrite: API keys are locked. Unlock to record.');
		plugin.promptUnlock();
		return null;
	}

	if (!isProfileConfigured(profile)) {
		new Notice('ReWrite: profile is not configured. Finish setup to use quick record.');
		new ReWriteModal(plugin.app, plugin).open();
		return null;
	}

	const template = pickQuickRecordTemplate(plugin);
	if (!template) {
		new Notice('ReWrite: add a template before using quick record.');
		new ReWriteModal(plugin.app, plugin).open();
		return null;
	}

	const isWebSpeech = profile.transcriptionProvider === 'webspeech';
	if (isWebSpeech && !isWebSpeechAvailable()) {
		new Notice('Web Speech is not available here. Opening the modal instead.');
		new ReWriteModal(plugin.app, plugin).open();
		return null;
	}
	if (!isWebSpeech && !isMediaRecorderAvailable()) {
		new Notice('Audio recording is not supported in this environment. Opening the modal instead.');
		new ReWriteModal(plugin.app, plugin).open();
		return null;
	}

	const controller = new QuickRecordController(plugin, template, isWebSpeech, onDispose);
	try {
		await controller.begin();
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		new Notice(`ReWrite quick record could not start: ${msg}`);
		onDispose();
		return null;
	}
	return controller;
}

function pickQuickRecordTemplate(plugin: ReWritePlugin): NoteTemplate | undefined {
	const s = plugin.settings;
	const templates = plugin.templates;
	return (
		templates.find((t) => t.id === s.defaultTemplateId)
		?? templates.find((t) => t.id === s.lastUsedTemplateId)
		?? templates[0]
	);
}

interface QuickRecordFloaterOptions {
	onStop: () => void;
	onCancel: () => void;
	getTemplates: () => NoteTemplate[];
	getActiveTemplateId: () => string;
	onPickTemplate: (t: NoteTemplate) => void;
	initialTemplateName: string;
}

class QuickRecordFloater {
	private readonly el: HTMLElement;
	private readonly timerEl: HTMLElement;
	private readonly templateBtn: HTMLButtonElement;
	private readonly templateLabel: HTMLElement;
	private popover: HTMLElement | null = null;
	private outsideClickHandler: ((e: MouseEvent) => void) | null = null;
	private keyHandler: ((e: KeyboardEvent) => void) | null = null;
	private busy = false;

	constructor(private readonly options: QuickRecordFloaterOptions) {
		this.el = document.body.createDiv({ cls: 'rewrite-quick-floater' });
		this.el.createSpan({ cls: 'rewrite-quick-dot' });
		this.el.createSpan({ cls: 'rewrite-quick-label', text: 'Recording' });
		this.timerEl = this.el.createSpan({ cls: 'rewrite-quick-timer', text: '0:00' });

		this.templateBtn = this.el.createEl('button', {
			cls: 'rewrite-quick-template',
		});
		this.templateLabel = this.templateBtn.createSpan({
			cls: 'rewrite-quick-template-label',
			text: options.initialTemplateName,
		});
		this.templateBtn.title = 'Change template';
		this.templateBtn.addEventListener('click', (e) => {
			if (this.busy) return;
			e.stopPropagation();
			this.togglePopover();
		});

		const stopBtn = this.el.createEl('button', {
			text: 'Stop',
			cls: 'mod-cta rewrite-quick-stop',
		});
		stopBtn.addEventListener('click', () => {
			if (this.busy) return;
			options.onStop();
		});
		const cancelBtn = this.el.createEl('button', {
			text: 'Cancel',
			cls: 'rewrite-quick-cancel',
		});
		cancelBtn.addEventListener('click', () => {
			if (this.busy) return;
			options.onCancel();
		});
	}

	setTime(label: string): void {
		if (!this.busy) this.timerEl.setText(label);
	}

	setBusy(label: string): void {
		this.busy = true;
		this.el.addClass('is-busy');
		this.timerEl.setText(label);
		this.templateBtn.disabled = true;
		this.closePopover();
	}

	setTemplateName(name: string): void {
		this.templateLabel.setText(name);
	}

	dispose(): void {
		this.closePopover();
		this.el.remove();
	}

	private togglePopover(): void {
		if (this.popover) {
			this.closePopover();
			return;
		}
		this.openPopover();
	}

	private openPopover(): void {
		const templates = this.options.getTemplates();
		if (templates.length === 0) return;
		const activeId = this.options.getActiveTemplateId();
		const popover = this.el.createDiv({ cls: 'rewrite-quick-popover' });
		for (const t of templates) {
			const item = popover.createEl('button', {
				cls: 'rewrite-quick-popover-item',
				text: t.name,
			});
			if (t.id === activeId) item.addClass('is-active');
			item.addEventListener('click', (e) => {
				e.stopPropagation();
				this.options.onPickTemplate(t);
				this.closePopover();
			});
		}
		this.popover = popover;

		this.outsideClickHandler = (e: MouseEvent) => {
			if (!this.popover) return;
			const target = e.target as Node | null;
			if (target && (this.popover.contains(target) || this.templateBtn.contains(target))) return;
			this.closePopover();
		};
		this.keyHandler = (e: KeyboardEvent) => {
			if (e.key === 'Escape') this.closePopover();
		};
		document.addEventListener('click', this.outsideClickHandler, true);
		document.addEventListener('keydown', this.keyHandler, true);
	}

	private closePopover(): void {
		if (this.outsideClickHandler) {
			document.removeEventListener('click', this.outsideClickHandler, true);
			this.outsideClickHandler = null;
		}
		if (this.keyHandler) {
			document.removeEventListener('keydown', this.keyHandler, true);
			this.keyHandler = null;
		}
		this.popover?.remove();
		this.popover = null;
	}
}

function stageLabel(stage: PipelineStage): string {
	switch (stage) {
		case 'persist-audio':
			return 'Saving audio...';
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
