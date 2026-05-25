import { Notice, Plugin } from 'obsidian';
import { loadSettings, saveSettings } from './settings';
import { ReWriteSettingTab } from './settings/tab';
import { ReWriteModal } from './ui/modal';
import { QuickRecordController, startQuickRecord } from './ui/quick-record';
import { resolveActiveTextSource, resolveTextFromEditor, runTextPipeline, TextResolution } from './ui/text-source';
import { TemplatePickerModal } from './ui/template-picker';
import { GlobalSettings } from './types';

export default class ReWritePlugin extends Plugin {
	settings!: GlobalSettings;
	private activeQuickRecord: QuickRecordController | null = null;

	async onload(): Promise<void> {
		this.settings = await loadSettings(this);
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
			name: 'Quick record',
			callback: () => {
				void this.toggleQuickRecord();
			},
		});

		this.addCommand({
			id: 'process-text',
			name: 'Process text with template',
			callback: () => {
				this.processTextWithTemplate();
			},
		});

		this.registerEvent(this.app.workspace.on('editor-menu', (menu, editor) => {
			menu.addItem((item) => {
				item.setTitle('ReWrite with template...');
				item.setIcon('mic');
				item.onClick(() => {
					this.processTextWithTemplate(resolveTextFromEditor(editor));
				});
			});
		}));
	}

	onunload(): void {
		this.activeQuickRecord?.cancel();
		this.activeQuickRecord = null;
	}

	async saveSettings(): Promise<void> {
		await saveSettings(this, this.settings);
	}

	private openModal(): void {
		new ReWriteModal(this.app, this).open();
	}

	private async toggleQuickRecord(): Promise<void> {
		if (this.activeQuickRecord) {
			await this.activeQuickRecord.finish();
			return;
		}
		this.activeQuickRecord = await startQuickRecord(this, () => {
			this.activeQuickRecord = null;
		});
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
		if (this.settings.templates.length === 0) {
			new Notice('Add a template in settings first.');
			return;
		}
		const previewText = source.scope === 'selection'
			? `Selection: ${source.text.length.toLocaleString()} chars`
			: `Whole note: ${source.text.length.toLocaleString()} chars`;
		new TemplatePickerModal({
			app: this.app,
			templates: this.settings.templates,
			defaultTemplateId: this.pickDefaultTemplateId(),
			previewText,
			onPick: (template) => {
				void runTextPipeline(this, template, source.text);
			},
		}).open();
	}

	private pickDefaultTemplateId(): string {
		const s = this.settings;
		if (s.lastUsedTemplateId && s.templates.some((t) => t.id === s.lastUsedTemplateId)) {
			return s.lastUsedTemplateId;
		}
		if (s.defaultTemplateId && s.templates.some((t) => t.id === s.defaultTemplateId)) {
			return s.defaultTemplateId;
		}
		return s.templates[0]?.id ?? '';
	}
}
