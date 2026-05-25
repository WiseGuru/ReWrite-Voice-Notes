import { App, Modal } from 'obsidian';
import { NoteTemplate } from '../types';

export interface TemplatePickerParams {
	app: App;
	templates: NoteTemplate[];
	defaultTemplateId: string;
	previewText: string;
	onPick: (template: NoteTemplate) => void;
}

export class TemplatePickerModal extends Modal {
	constructor(private readonly params: TemplatePickerParams) {
		super(params.app);
	}

	onOpen(): void {
		this.modalEl.addClass('rewrite-modal');
		const { contentEl } = this;
		contentEl.createEl('h2', { text: 'Pick a template' });
		if (this.params.previewText) {
			contentEl.createEl('p', {
				text: this.params.previewText,
				cls: 'rewrite-template-picker-preview',
			});
		}

		if (this.params.templates.length === 0) {
			contentEl.createEl('p', { text: 'No templates configured. Add one in settings.' });
			return;
		}

		const list = contentEl.createDiv({ cls: 'rewrite-template-picker-list' });
		for (const template of this.params.templates) {
			const item = list.createEl('button', {
				text: template.name || '(unnamed)',
				cls: 'rewrite-template-picker-item',
			});
			if (template.id === this.params.defaultTemplateId) item.addClass('mod-cta');
			item.addEventListener('click', () => {
				this.close();
				this.params.onPick(template);
			});
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
