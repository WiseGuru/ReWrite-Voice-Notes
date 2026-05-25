import { App, Modal, Notice, PluginSettingTab, Setting } from 'obsidian';
import type ReWritePlugin from '../main';
import {
	ActiveProfileKind,
	ActiveProfileOverride,
	EnvironmentProfile,
	InsertMode,
	LLMProviderID,
	NoteTemplate,
	RecordingFormatPreference,
	TranscriptionProviderID,
} from '../types';
import { detectActiveProfileKind } from '../platform';

const TRANSCRIPTION_OPTIONS: Array<{ id: TranscriptionProviderID; label: string }> = [
	{ id: 'openai', label: 'OpenAI Whisper' },
	{ id: 'openai-compatible', label: 'OpenAI-compatible (local server)' },
	{ id: 'groq', label: 'Groq' },
	{ id: 'assemblyai', label: 'AssemblyAI' },
	{ id: 'deepgram', label: 'Deepgram' },
	{ id: 'revai', label: 'Rev.ai' },
	{ id: 'webspeech', label: 'Web Speech (browser)' },
];

const LLM_OPTIONS: Array<{ id: LLMProviderID; label: string }> = [
	{ id: 'anthropic', label: 'Anthropic Claude' },
	{ id: 'openai', label: 'OpenAI GPT' },
	{ id: 'openai-compatible', label: 'OpenAI-compatible (local server)' },
	{ id: 'gemini', label: 'Google Gemini' },
	{ id: 'mistral', label: 'Mistral' },
];

const INSERT_MODE_OPTIONS: Array<{ id: InsertMode; label: string }> = [
	{ id: 'cursor', label: 'Insert at cursor' },
	{ id: 'newFile', label: 'Create new file' },
	{ id: 'append', label: 'Append to active note' },
];

const RECORDING_FORMAT_OPTIONS: Array<{ id: RecordingFormatPreference; label: string }> = [
	{ id: 'webm', label: 'webm (best on Chromium/Electron)' },
	{ id: 'mp4', label: 'mp4 (best on mobile/Safari)' },
];

export class ReWriteSettingTab extends PluginSettingTab {
	private editingTemplateId: string | null = null;
	private dragSourceIndex: number | null = null;

	constructor(app: App, private readonly plugin: ReWritePlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass('rewrite-settings');

		this.renderActiveProfile(containerEl);
		this.renderProfile(containerEl, 'desktop');
		this.renderProfile(containerEl, 'mobile');
		this.renderTemplates(containerEl);
		this.renderRecording(containerEl);
	}

	private async commit(): Promise<void> {
		await this.plugin.saveSettings();
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
		new Setting(parent).setName(title).setHeading();

		new Setting(parent)
			.setName('Profile label')
			.setDesc('Display name for this profile.')
			.addText((t) => {
				t.setValue(profile.name);
				t.onChange(async (v) => {
					profile.name = v;
					await this.commit();
				});
			});

		new Setting(parent)
			.setName('Transcription provider')
			.addDropdown((dd) => {
				for (const opt of TRANSCRIPTION_OPTIONS) dd.addOption(opt.id, opt.label);
				dd.setValue(profile.transcriptionProvider);
				dd.onChange(async (v) => {
					profile.transcriptionProvider = v as TranscriptionProviderID;
					await this.commit();
					this.display();
				});
			});

		if (profile.transcriptionProvider !== 'webspeech') {
			new Setting(parent)
				.setName('Transcription model')
				.setDesc(transcriptionModelHint(profile.transcriptionProvider))
				.addText((t) => {
					t.setValue(profile.transcriptionConfig.model);
					t.onChange(async (v) => {
						profile.transcriptionConfig.model = v;
						await this.commit();
					});
				});

			if (profile.transcriptionProvider === 'openai-compatible') {
				new Setting(parent)
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

			new Setting(parent)
				.setName('Transcription API key')
				.addText((t) => {
					t.inputEl.type = 'password';
					t.setPlaceholder('Saved securely on this device');
					t.setValue(profile.transcriptionConfig.apiKey);
					t.onChange(async (v) => {
						profile.transcriptionConfig.apiKey = v;
						await this.commit();
					});
				});
		}

		new Setting(parent)
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

		new Setting(parent)
			.setName('LLM model')
			.setDesc(llmModelHint(profile.llmProvider))
			.addText((t) => {
				t.setValue(profile.llmConfig.model);
				t.onChange(async (v) => {
					profile.llmConfig.model = v;
					await this.commit();
				});
			});

		if (profile.llmProvider === 'openai-compatible') {
			new Setting(parent)
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

		new Setting(parent)
			.setName('LLM API key')
			.addText((t) => {
				t.inputEl.type = 'password';
				t.setPlaceholder('Saved securely on this device');
				t.setValue(profile.llmConfig.apiKey);
				t.onChange(async (v) => {
					profile.llmConfig.apiKey = v;
					await this.commit();
				});
			});

		this.renderProfileAdvanced(parent, profile);
	}

	private renderProfileAdvanced(parent: HTMLElement, profile: EnvironmentProfile): void {
		const details = parent.createEl('details', { cls: 'rewrite-advanced' });
		details.createEl('summary', { text: 'Advanced' });

		if (profile.transcriptionProvider !== 'webspeech') {
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

	private renderTemplates(parent: HTMLElement): void {
		new Setting(parent).setName('Templates').setHeading();
		parent.createEl('p', {
			text: 'Drag the handle to reorder. Templates appear in the modal dropdown in this order.',
			cls: 'rewrite-section-desc',
		});

		const templates = this.plugin.settings.templates;
		const list = parent.createDiv({ cls: 'rewrite-templates-list' });

		if (templates.length === 0) {
			list.createEl('p', {
				text: 'No templates configured. Add one to get started.',
				cls: 'rewrite-templates-empty',
			});
		} else {
			for (let i = 0; i < templates.length; i++) {
				const template = templates[i];
				if (!template) continue;
				this.renderTemplateItem(list, template, i);
			}
		}

		const actions = parent.createDiv({ cls: 'rewrite-templates-actions' });
		const addBtn = actions.createEl('button', { text: 'Add template', cls: 'mod-cta' });
		addBtn.addEventListener('click', () => {
			void this.addTemplate();
		});
	}

	private renderTemplateItem(parent: HTMLElement, template: NoteTemplate, index: number): void {
		const item = parent.createDiv({ cls: 'rewrite-template-item' });
		item.draggable = true;
		item.dataset.index = String(index);

		item.addEventListener('dragstart', (ev) => {
			this.dragSourceIndex = index;
			item.addClass('is-dragging');
			if (ev.dataTransfer) {
				ev.dataTransfer.effectAllowed = 'move';
				ev.dataTransfer.setData('text/plain', String(index));
			}
		});
		item.addEventListener('dragend', () => {
			item.removeClass('is-dragging');
			this.dragSourceIndex = null;
		});
		item.addEventListener('dragover', (ev) => {
			ev.preventDefault();
			if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
			item.addClass('is-drop-target');
		});
		item.addEventListener('dragleave', () => {
			item.removeClass('is-drop-target');
		});
		item.addEventListener('drop', (ev) => {
			ev.preventDefault();
			item.removeClass('is-drop-target');
			const from = this.dragSourceIndex;
			this.dragSourceIndex = null;
			void this.reorderTemplate(from, index);
		});

		const header = item.createDiv({ cls: 'rewrite-template-header' });
		const handle = header.createSpan({ cls: 'rewrite-drag-handle', text: '⋮⋮' });
		handle.setAttr('aria-label', 'Drag to reorder');
		header.createSpan({
			cls: 'rewrite-template-name',
			text: template.name || '(unnamed)',
		});

		const isEditing = this.editingTemplateId === template.id;
		const actions = header.createDiv({ cls: 'rewrite-template-actions' });
		const editBtn = actions.createEl('button', { text: isEditing ? 'Close' : 'Edit' });
		editBtn.addEventListener('click', () => {
			this.editingTemplateId = isEditing ? null : template.id;
			this.display();
		});
		const deleteBtn = actions.createEl('button', { text: 'Delete' });
		deleteBtn.addEventListener('click', () => {
			this.deleteTemplate(template);
		});

		if (isEditing) {
			this.renderTemplateEditor(item, template);
		}
	}

	private renderTemplateEditor(parent: HTMLElement, template: NoteTemplate): void {
		const editor = parent.createDiv({ cls: 'rewrite-template-editor' });

		new Setting(editor)
			.setName('Name')
			.addText((t) => {
				t.setValue(template.name);
				t.onChange(async (v) => {
					template.name = v;
					await this.commit();
				});
			});

		new Setting(editor)
			.setName('Prompt')
			.setDesc('System prompt sent to the LLM. The raw transcript is passed as the user message.')
			.addTextArea((t) => {
				t.setValue(template.prompt);
				t.onChange(async (v) => {
					template.prompt = v;
					await this.commit();
				});
				t.inputEl.rows = 6;
				t.inputEl.addClass('rewrite-prompt-textarea');
			});

		new Setting(editor)
			.setName('Insert mode')
			.addDropdown((dd) => {
				for (const opt of INSERT_MODE_OPTIONS) dd.addOption(opt.id, opt.label);
				dd.setValue(template.insertMode);
				dd.onChange(async (v) => {
					template.insertMode = v as InsertMode;
					await this.commit();
					this.display();
				});
			});

		if (template.insertMode === 'newFile') {
			new Setting(editor)
				.setName('New file folder')
				.setDesc('Vault-relative folder. Leave blank for vault root.')
				.addText((t) => {
					t.setValue(template.newFileFolder);
					t.onChange(async (v) => {
						template.newFileFolder = v;
						await this.commit();
					});
				});

			new Setting(editor)
				.setName('New file name template')
				.setDesc('Supports {{date}} (YYYY-MM-DD) and {{time}} (HHmmss).')
				.addText((t) => {
					t.setValue(template.newFileNameTemplate);
					t.setPlaceholder('ReWrite {{date}} {{time}}');
					t.onChange(async (v) => {
						template.newFileNameTemplate = v;
						await this.commit();
					});
				});
		}
	}

	private async addTemplate(): Promise<void> {
		const newTemplate: NoteTemplate = {
			id: generateTemplateId(),
			name: 'Untitled template',
			prompt: 'Clean up the transcript while preserving the original meaning.',
			insertMode: 'cursor',
			newFileFolder: '',
			newFileNameTemplate: 'ReWrite {{date}} {{time}}',
		};
		this.plugin.settings.templates.push(newTemplate);
		this.editingTemplateId = newTemplate.id;
		await this.commit();
		this.display();
	}

	private async reorderTemplate(from: number | null, to: number): Promise<void> {
		if (from === null || from === to) return;
		const templates = this.plugin.settings.templates;
		if (from < 0 || from >= templates.length || to < 0 || to >= templates.length) return;
		const [moved] = templates.splice(from, 1);
		if (!moved) return;
		templates.splice(to, 0, moved);
		await this.commit();
		this.display();
	}

	private deleteTemplate(template: NoteTemplate): void {
		new ConfirmModal(this.app, `Delete template "${template.name}"?`, 'Delete', async () => {
			const s = this.plugin.settings;
			s.templates = s.templates.filter((t) => t.id !== template.id);
			if (s.defaultTemplateId === template.id) s.defaultTemplateId = '';
			if (s.lastUsedTemplateId === template.id) s.lastUsedTemplateId = '';
			if (this.editingTemplateId === template.id) this.editingTemplateId = null;
			await this.commit();
			this.display();
			new Notice('Template deleted.');
		}).open();
	}

	private renderRecording(parent: HTMLElement): void {
		new Setting(parent).setName('Recording').setHeading();
		new Setting(parent)
			.setName('Audio format preference')
			.setDesc('Web Speech ignores this. Use mp4 on iOS, otherwise webm.')
			.addDropdown((dd) => {
				for (const opt of RECORDING_FORMAT_OPTIONS) dd.addOption(opt.id, opt.label);
				dd.setValue(this.plugin.settings.recordingFormat);
				dd.onChange(async (v) => {
					this.plugin.settings.recordingFormat = v as RecordingFormatPreference;
					await this.commit();
				});
			});
	}
}

class ConfirmModal extends Modal {
	constructor(
		app: App,
		private readonly message: string,
		private readonly confirmLabel: string,
		private readonly onConfirm: () => void | Promise<void>,
	) {
		super(app);
	}

	onOpen(): void {
		this.contentEl.createEl('p', { text: this.message });
		const actions = this.contentEl.createDiv({ cls: 'rewrite-modal-actions' });
		const cancel = actions.createEl('button', { text: 'Cancel' });
		cancel.addEventListener('click', () => this.close());
		const confirm = actions.createEl('button', { text: this.confirmLabel, cls: 'mod-warning' });
		confirm.addEventListener('click', () => {
			this.close();
			void this.onConfirm();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

function generateTemplateId(): string {
	return `tpl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function transcriptionModelHint(id: TranscriptionProviderID): string {
	switch (id) {
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
		case 'openai-compatible':
			return 'Whichever model your local server exposes';
		case 'webspeech':
			return '';
	}
}

function llmModelHint(id: LLMProviderID): string {
	switch (id) {
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
