import { App, Notice, Platform } from 'obsidian';
import type ReWritePlugin from '../main';
import { PipelineSource, PipelineStage, runPipeline } from '../pipeline';
import { isMediaRecorderAvailable, resolveActiveProfile } from '../platform';
import { Recorder } from '../recorder';
import { NoteTemplate } from '../types';
import { isProfileConfigured } from './setup-card';
import { ReWriteModal } from './modal';

// Continuous silence (ms) before the Quick Record floater warns about a muted / dead mic.
const SILENCE_WARNING_MS = 3000;
const SILENCE_WARNING_TEXT = 'No audio detected. Check that your microphone is on and not muted.';

export class QuickRecordController {
	private recorder: Recorder | null = null;
	private timerHandle: number | null = null;
	private floater: QuickRecordFloater | null = null;
	private settled = false;
	private template: NoteTemplate;

	constructor(
		private readonly plugin: ReWritePlugin,
		template: NoteTemplate,
		private readonly onDispose: () => void,
		private readonly stopHotkey: string | null = null,
	) {
		this.template = template;
	}

	async begin(): Promise<void> {
		this.recorder = new Recorder();
		await this.recorder.start(this.plugin.settings.recordingFormat);
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
			stopHotkey: this.stopHotkey,
		});
		this.timerHandle = window.setInterval(() => {
			const ms = this.recorder?.getElapsedMs() ?? 0;
			this.floater?.setTime(formatDuration(ms));
			const silent = (this.recorder?.getSilentMs() ?? 0) > SILENCE_WARNING_MS;
			this.floater?.setSilenceWarning(silent);
		}, 250);
	}

	cancel(): void {
		if (this.settled) return;
		this.settled = true;
		this.stopTimer();
		this.recorder?.cancel();
		this.recorder = null;
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
		if (!this.recorder) throw new Error('No active recording.');
		const result = await this.recorder.stop();
		this.recorder = null;
		return { kind: 'audio', audio: result.blob, durationMs: result.durationMs };
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
	opts?: { template?: NoteTemplate; commandId?: string },
): Promise<QuickRecordController | null> {
	const settings = plugin.settings;
	const { profile } = resolveActiveProfile(settings);

	if (plugin.encryptionStatus.locked) {
		new Notice('ReWrite: API keys are locked. Unlock to record.');
		plugin.promptUnlock();
		return null;
	}

	if (profile.transcriptionProvider === 'none') {
		new Notice('ReWrite: transcription is disabled for this profile. Opening the modal so you can paste text instead.');
		new ReWriteModal(plugin.app, plugin).open();
		return null;
	}

	if (!isProfileConfigured(profile)) {
		new Notice('ReWrite: profile is not configured. Finish setup to use quick record.');
		new ReWriteModal(plugin.app, plugin).open();
		return null;
	}

	const template = opts?.template ?? pickQuickRecordTemplate(plugin);
	if (!template) {
		new Notice('ReWrite: add a template before using quick record.');
		new ReWriteModal(plugin.app, plugin).open();
		return null;
	}

	if (!isMediaRecorderAvailable()) {
		new Notice('Audio recording is not supported in this environment. Opening the modal instead.');
		new ReWriteModal(plugin.app, plugin).open();
		return null;
	}

	const stopHotkey = opts?.commandId ? formatCommandHotkey(plugin.app, opts.commandId) : null;
	const controller = new QuickRecordController(plugin, template, onDispose, stopHotkey);
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
		templates.find((t) => t.id === s.lastUsedTemplateId)
		?? templates.find((t) => t.id === s.defaultTemplateId)
		?? templates[0]
	);
}

interface Hotkey {
	modifiers: string[];
	key: string;
}

interface HotkeyManager {
	getHotkeys(id: string): Hotkey[] | undefined;
	getDefaultHotkeys(id: string): Hotkey[] | undefined;
}

// Obsidian's hotkey manager is internal and not in the public typings; read through a
// narrow cast. Returns null when the command has no binding (custom or default).
function formatCommandHotkey(app: App, commandId: string): string | null {
	const manager = (app as unknown as { hotkeyManager?: HotkeyManager }).hotkeyManager;
	if (!manager) return null;
	const hotkeys = manager.getHotkeys(commandId) ?? manager.getDefaultHotkeys(commandId);
	const hotkey = hotkeys?.[0];
	if (!hotkey) return null;
	const mac = Platform.isMacOS;
	const symbols: Record<string, string> = {
		Mod: mac ? '⌘' : 'Ctrl',
		Meta: mac ? '⌘' : 'Win',
		Ctrl: 'Ctrl',
		Shift: mac ? '⇧' : 'Shift',
		Alt: mac ? '⌥' : 'Alt',
	};
	const parts = hotkey.modifiers.map((m) => symbols[m] ?? m);
	parts.push(hotkey.key.length === 1 ? hotkey.key.toUpperCase() : hotkey.key);
	return mac ? parts.join('') : parts.join('+');
}

interface QuickRecordFloaterOptions {
	onStop: () => void;
	onCancel: () => void;
	getTemplates: () => NoteTemplate[];
	getActiveTemplateId: () => string;
	onPickTemplate: (t: NoteTemplate) => void;
	initialTemplateName: string;
	stopHotkey?: string | null;
}

class QuickRecordFloater {
	private readonly el: HTMLElement;
	private readonly timerEl: HTMLElement;
	private readonly warningEl: HTMLElement;
	private readonly templateBtn: HTMLButtonElement;
	private readonly templateLabel: HTMLElement;
	private popover: HTMLElement | null = null;
	private outsideClickHandler: ((e: MouseEvent) => void) | null = null;
	private keyHandler: ((e: KeyboardEvent) => void) | null = null;
	private busy = false;

	constructor(private readonly options: QuickRecordFloaterOptions) {
		this.el = document.body.createDiv({ cls: 'rewrite-quick-floater' });
		const row = this.el.createDiv({ cls: 'rewrite-quick-row' });
		row.createSpan({ cls: 'rewrite-quick-dot' });
		row.createSpan({ cls: 'rewrite-quick-label', text: 'Recording' });
		this.timerEl = row.createSpan({ cls: 'rewrite-quick-timer', text: '0:00' });

		this.templateBtn = row.createEl('button', {
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

		if (options.stopHotkey) {
			row.createSpan({
				cls: 'rewrite-quick-stop-hint',
				text: `Press ${options.stopHotkey} or`,
			});
		}

		const stopBtn = row.createEl('button', {
			text: 'Stop',
			cls: 'mod-cta rewrite-quick-stop',
		});
		stopBtn.addEventListener('click', () => {
			if (this.busy) return;
			options.onStop();
		});
		const cancelBtn = row.createEl('button', {
			text: 'Cancel',
			cls: 'rewrite-quick-cancel',
		});
		cancelBtn.addEventListener('click', () => {
			if (this.busy) return;
			options.onCancel();
		});

		this.warningEl = this.el.createDiv({
			cls: 'rewrite-quick-silence-warning',
			text: SILENCE_WARNING_TEXT,
		});
		this.warningEl.hide();
	}

	setSilenceWarning(show: boolean): void {
		if (this.busy || show === false) {
			this.warningEl.hide();
			return;
		}
		this.warningEl.show();
	}

	setTime(label: string): void {
		if (!this.busy) this.timerEl.setText(label);
	}

	setBusy(label: string): void {
		this.busy = true;
		this.el.addClass('is-busy');
		this.timerEl.setText(label);
		this.templateBtn.disabled = true;
		this.warningEl.hide();
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
