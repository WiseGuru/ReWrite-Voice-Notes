import { App, Modal, Notice, Setting, TFolder, normalizePath } from 'obsidian';
import { IngestRule, NoteTemplate } from '../types';
import { isIngestTemplate } from '../ingest';

export interface IngestRuleModalParams {
	app: App;
	// Loaded templates; the dropdown filters to newFile-mode ones.
	templates: NoteTemplate[];
	// Existing rule when editing, undefined when adding.
	rule?: IngestRule;
	onSubmit: (rule: IngestRule) => Promise<void>;
}

// Popup editor for one auto-ingest rule (folder + template + enabled), per the
// settings-UI-is-a-modal decision in the roadmap. The template dropdown only
// offers newFile templates: unattended ingest has no active editor, so cursor /
// append would cascade into newFile anyway — requiring newFile makes the
// destination explicit.
export class IngestRuleModal extends Modal {
	private folderPath: string;
	private templateId: string;
	private enabled: boolean;

	constructor(private readonly params: IngestRuleModalParams) {
		super(params.app);
		this.folderPath = params.rule?.folderPath ?? '';
		this.templateId = params.rule?.templateId ?? '';
		this.enabled = params.rule?.enabled ?? true;
	}

	onOpen(): void {
		this.modalEl.addClass('rewrite-modal');
		const { contentEl } = this;
		contentEl.createEl('h2', { text: this.params.rule ? 'Edit ingest folder' : 'Add ingest folder' });
		contentEl.createEl('p', {
			text: 'When you run the process auto-ingest folders command, every audio file in this folder is turned into a note with the chosen template, then moved in with your other recordings. Files that fail stay put and are retried next run.',
			cls: 'rewrite-section-desc',
		});

		new Setting(contentEl)
			.setName('Folder')
			.setDesc('Vault-relative path. Only files directly in this folder are processed, not subfolders.')
			.addText((t) => {
				t.setValue(this.folderPath);
				t.setPlaceholder('Voice inbox');
				t.onChange((v) => {
					this.folderPath = v;
				});
			});

		const eligible = this.params.templates.filter((t) => isIngestTemplate(t));
		if (eligible.length === 0) {
			contentEl.createEl('p', {
				text: 'No templates create a new file. Ingest needs a template whose insert mode is "newFile"; add or edit one first.',
				cls: 'rewrite-warning-text',
			});
		} else {
			new Setting(contentEl)
				.setName('Template')
				.setDesc('Only templates that create a new file are offered; each recording becomes its own note.')
				.addDropdown((dd) => {
					dd.addOption('', '(pick a template)');
					for (const tpl of eligible) dd.addOption(tpl.id, tpl.name);
					dd.setValue(eligible.some((t) => t.id === this.templateId) ? this.templateId : '');
					dd.onChange((v) => {
						this.templateId = v;
					});
				});
		}

		new Setting(contentEl)
			.setName('Enabled')
			.setDesc('Disabled rules are kept but skipped by the command.')
			.addToggle((t) => {
				t.setValue(this.enabled);
				t.onChange((v) => {
					this.enabled = v;
				});
			});

		const actions = contentEl.createDiv({ cls: 'rewrite-setup-actions' });
		const save = actions.createEl('button', { text: 'Save', cls: 'mod-cta' });
		save.addEventListener('click', () => {
			void this.save();
		});
		const cancel = actions.createEl('button', { text: 'Cancel' });
		cancel.addEventListener('click', () => this.close());
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async save(): Promise<void> {
		const folder = this.folderPath.trim();
		if (!folder) {
			new Notice('ReWrite: set a folder path.');
			return;
		}
		if (!(this.app.vault.getAbstractFileByPath(normalizePath(folder)) instanceof TFolder)) {
			new Notice(`ReWrite: folder "${folder}" was not found in this vault.`);
			return;
		}
		if (!this.templateId) {
			new Notice('ReWrite: pick a template.');
			return;
		}
		await this.params.onSubmit({
			folderPath: folder,
			templateId: this.templateId,
			enabled: this.enabled,
		});
		this.close();
	}
}
