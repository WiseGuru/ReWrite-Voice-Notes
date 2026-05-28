import { App, MarkdownView, Modal, moment, normalizePath, Notice, Setting, TFile } from 'obsidian';
import { NewFileCollisionMode, NoteTemplate } from './types';

export type InsertStage = 'cursor' | 'newFile' | 'append';

export interface InsertParams {
	app: App;
	template: NoteTemplate;
	content: string;
	collisionMode: NewFileCollisionMode;
}

export interface InsertResult {
	mode: InsertStage;
	path?: string;
}

export async function insertOutput(params: InsertParams): Promise<InsertResult> {
	switch (params.template.insertMode) {
		case 'cursor':
			return insertAtCursor(params);
		case 'newFile':
			return insertNewFile(params);
		case 'append':
			return insertAppend(params);
	}
}

async function insertAtCursor(params: InsertParams): Promise<InsertResult> {
	const view = params.app.workspace.getActiveViewOfType(MarkdownView);
	if (!view) {
		new Notice('No active editor; appending to the last edited note instead.');
		return insertAppend(params);
	}
	view.editor.replaceSelection(params.content);
	return { mode: 'cursor', path: view.file?.path };
}

async function insertAppend(params: InsertParams): Promise<InsertResult> {
	const view = params.app.workspace.getActiveViewOfType(MarkdownView);
	let file: TFile | null = view?.file ?? null;
	if (!file) {
		file = findLastEditedMarkdown(params.app);
	}
	if (!file) {
		new Notice('No note is open. Creating a new note.');
		return insertNewFile(params);
	}
	const existing = await params.app.vault.read(file);
	const needsBlankLine = existing.length > 0 && !existing.endsWith('\n\n');
	const separator = existing.length === 0 ? '' : needsBlankLine ? (existing.endsWith('\n') ? '\n' : '\n\n') : '';
	await params.app.vault.modify(file, existing + separator + params.content);
	return { mode: 'append', path: file.path };
}

async function insertNewFile(params: InsertParams): Promise<InsertResult> {
	const folder = params.template.newFileFolder.trim();
	const nameTemplate = params.template.newFileNameTemplate.trim() || 'ReWrite {{date}} {{time}}';
	const expanded = expandFilenameTemplate(nameTemplate);
	const filename = expanded.endsWith('.md') ? expanded : `${expanded}.md`;
	if (folder) {
		await ensureFolder(params.app, folder);
	}
	const requestedPath = normalizePath(folder ? `${folder}/${filename}` : filename);
	const path = await resolveNewFilePath(params.app, requestedPath, params.collisionMode);
	const file = await params.app.vault.create(path, params.content);
	await params.app.workspace.openLinkText(file.path, '', true);
	return { mode: 'newFile', path: file.path };
}

async function resolveNewFilePath(app: App, requestedPath: string, mode: NewFileCollisionMode): Promise<string> {
	if (!app.vault.getAbstractFileByPath(requestedPath)) return requestedPath;
	const nextFree = nextFreePath(app, requestedPath);
	if (mode === 'auto') return nextFree;
	const chosen = await promptForRename(app, requestedPath, nextFree);
	if (chosen === null) {
		throw new Error('Insert canceled: file already exists.');
	}
	if (app.vault.getAbstractFileByPath(chosen)) {
		throw new Error(`File still exists at ${chosen}. Try again with a different name.`);
	}
	return chosen;
}

function nextFreePath(app: App, path: string): string {
	const slash = path.lastIndexOf('/');
	const dot = path.lastIndexOf('.');
	const hasExt = dot > slash;
	const stem = hasExt ? path.slice(0, dot) : path;
	const ext = hasExt ? path.slice(dot) : '';
	for (let n = 1; n < 1000; n++) {
		const candidate = `${stem}-${n}${ext}`;
		if (!app.vault.getAbstractFileByPath(candidate)) return candidate;
	}
	throw new Error(`Could not find a free filename near ${path}.`);
}

function promptForRename(app: App, conflictPath: string, suggestion: string): Promise<string | null> {
	return new Promise((resolve) => {
		const modal = new RenamePromptModal(app, conflictPath, suggestion, resolve);
		modal.open();
	});
}

class RenamePromptModal extends Modal {
	private resolved = false;

	constructor(
		app: App,
		private readonly conflictPath: string,
		private readonly suggestion: string,
		private readonly resolve: (value: string | null) => void,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		this.modalEl.addClass('rewrite-rename-modal');
		contentEl.createEl('h2', { text: 'File already exists' });
		contentEl.createEl('p', { text: `A file already exists at ${this.conflictPath}. Choose a new path.` });

		let value = this.suggestion;
		new Setting(contentEl)
			.setName('New path')
			.addText((t) => {
				t.setValue(this.suggestion);
				t.inputEl.addClass('rewrite-rename-input');
				t.onChange((v) => {
					value = v;
				});
				window.setTimeout(() => {
					t.inputEl.focus();
					const dot = this.suggestion.lastIndexOf('.');
					const slash = this.suggestion.lastIndexOf('/');
					const end = dot > slash ? dot : this.suggestion.length;
					t.inputEl.setSelectionRange(slash + 1, end);
				}, 0);
				t.inputEl.addEventListener('keydown', (e) => {
					if (e.key === 'Enter') {
						e.preventDefault();
						this.finish(value);
					}
				});
			});

		new Setting(contentEl)
			.addButton((b) => {
				b.setButtonText('Save').setCta().onClick(() => this.finish(value));
			})
			.addButton((b) => {
				b.setButtonText('Cancel').onClick(() => this.finish(null));
			});
	}

	onClose(): void {
		this.contentEl.empty();
		if (!this.resolved) {
			this.resolved = true;
			this.resolve(null);
		}
	}

	private finish(value: string | null): void {
		if (this.resolved) return;
		const trimmed = value === null ? null : normalizePath(value.trim());
		if (trimmed !== null && trimmed.length === 0) {
			new Notice('Path cannot be empty.');
			return;
		}
		this.resolved = true;
		this.resolve(trimmed);
		this.close();
	}
}

function expandFilenameTemplate(template: string): string {
	const now = moment();
	return template
		.replace(/\{\{date\}\}/g, now.format('YYYY-MM-DD'))
		.replace(/\{\{time\}\}/g, now.format('HHmmss'));
}

function findLastEditedMarkdown(app: App): TFile | null {
	const files = app.vault.getMarkdownFiles();
	let best: TFile | null = null;
	let bestMtime = -1;
	for (const f of files) {
		if (f.stat.mtime > bestMtime) {
			bestMtime = f.stat.mtime;
			best = f;
		}
	}
	return best;
}

async function ensureFolder(app: App, folder: string): Promise<void> {
	const normalized = normalizePath(folder);
	if (app.vault.getAbstractFileByPath(normalized)) return;
	const parts = normalized.split('/');
	let current = '';
	for (const part of parts) {
		if (!part) continue;
		current = current ? `${current}/${part}` : part;
		if (!app.vault.getAbstractFileByPath(current)) {
			await app.vault.createFolder(current);
		}
	}
}
