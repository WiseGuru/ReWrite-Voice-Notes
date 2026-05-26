import { App, normalizePath, parseYaml, stringifyYaml, TFile, TFolder } from 'obsidian';
import { InsertMode, NoteTemplate } from './types';
import { freshDefaultTemplates } from './settings/default-templates';

const VALID_INSERT_MODES: ReadonlySet<string> = new Set(['cursor', 'newFile', 'append']);

export async function loadTemplatesFromFolder(app: App, folderPath: string): Promise<NoteTemplate[]> {
	const normalized = normalizeFolderPath(folderPath);
	if (!normalized) return [];
	const folder = app.vault.getAbstractFileByPath(normalized);
	if (!(folder instanceof TFolder)) return [];

	const items: Array<{ template: NoteTemplate; basename: string }> = [];
	for (const child of folder.children) {
		if (!(child instanceof TFile)) continue;
		if (child.extension !== 'md') continue;
		try {
			const template = await parseTemplateFile(app, child);
			if (template) items.push({ template, basename: child.basename });
		} catch {
			// Skip files with invalid frontmatter so a bad file doesn't hide the rest.
		}
	}
	items.sort((a, b) => a.basename.localeCompare(b.basename));
	return items.map((i) => i.template);
}

export interface PopulateResult {
	created: number;
	skipped: number;
	folder: string;
}

export async function populateDefaultTemplates(app: App, folderPath: string): Promise<PopulateResult> {
	const normalized = normalizeFolderPath(folderPath);
	if (!normalized) throw new Error('Templates folder path is empty.');

	const folder = await ensureFolder(app, normalized);
	const existingIds = await collectExistingIds(app, folder);

	let created = 0;
	let skipped = 0;
	for (const template of freshDefaultTemplates()) {
		if (existingIds.has(template.id)) {
			skipped++;
			continue;
		}
		const filename = `${sanitizeFilename(template.name)}.md`;
		const path = normalizePath(`${normalized}/${filename}`);
		if (app.vault.getAbstractFileByPath(path)) {
			skipped++;
			continue;
		}
		await app.vault.create(path, renderTemplateFile(template));
		created++;
	}
	return { created, skipped, folder: normalized };
}

export function isPathInTemplatesFolder(path: string, folderPath: string): boolean {
	const normalizedFolder = normalizeFolderPath(folderPath);
	if (!normalizedFolder) return false;
	const normalizedPath = normalizePath(path);
	return normalizedPath === normalizedFolder
		|| normalizedPath.startsWith(`${normalizedFolder}/`);
}

async function parseTemplateFile(app: App, file: TFile): Promise<NoteTemplate | null> {
	const content = await app.vault.read(file);
	const { frontmatter, body } = splitFrontmatter(content);
	if (!frontmatter) return null;
	const parsed: unknown = parseYaml(frontmatter);
	if (!parsed || typeof parsed !== 'object') return null;
	const obj = parsed as Record<string, unknown>;

	const id = typeof obj.id === 'string' ? obj.id.trim() : '';
	if (!id) return null;

	const nameRaw = typeof obj.name === 'string' ? obj.name.trim() : '';
	const name = nameRaw || file.basename;

	const insertMode: InsertMode = typeof obj.insertMode === 'string' && VALID_INSERT_MODES.has(obj.insertMode)
		? (obj.insertMode as InsertMode)
		: 'cursor';

	const newFileFolder = typeof obj.newFileFolder === 'string' ? obj.newFileFolder : '';
	const newFileNameTemplateRaw = typeof obj.newFileNameTemplate === 'string' ? obj.newFileNameTemplate : '';
	const newFileNameTemplate = newFileNameTemplateRaw || 'ReWrite {{date}} {{time}}';

	return {
		id,
		name,
		prompt: body.trim(),
		insertMode,
		newFileFolder,
		newFileNameTemplate,
	};
}

async function collectExistingIds(app: App, folder: TFolder): Promise<Set<string>> {
	const ids = new Set<string>();
	for (const child of folder.children) {
		if (!(child instanceof TFile)) continue;
		if (child.extension !== 'md') continue;
		try {
			const content = await app.vault.read(child);
			const { frontmatter } = splitFrontmatter(content);
			if (!frontmatter) continue;
			const parsed: unknown = parseYaml(frontmatter);
			if (!parsed || typeof parsed !== 'object') continue;
			const id = (parsed as Record<string, unknown>).id;
			if (typeof id === 'string' && id.trim()) ids.add(id.trim());
		} catch {
			// Skip unreadable files.
		}
	}
	return ids;
}

async function ensureFolder(app: App, path: string): Promise<TFolder> {
	const existing = app.vault.getAbstractFileByPath(path);
	if (existing instanceof TFolder) return existing;
	if (existing) throw new Error(`${path} exists but is not a folder.`);
	const created = await app.vault.createFolder(path);
	if (created instanceof TFolder) return created;
	const resolved = app.vault.getAbstractFileByPath(path);
	if (resolved instanceof TFolder) return resolved;
	throw new Error(`Failed to create folder ${path}.`);
}

function splitFrontmatter(content: string): { frontmatter: string | null; body: string } {
	if (!content.startsWith('---')) return { frontmatter: null, body: content };
	const lines = content.split(/\r?\n/);
	if (lines[0]?.trim() !== '---') return { frontmatter: null, body: content };
	for (let i = 1; i < lines.length; i++) {
		if (lines[i]?.trim() === '---') {
			return {
				frontmatter: lines.slice(1, i).join('\n'),
				body: lines.slice(i + 1).join('\n'),
			};
		}
	}
	return { frontmatter: null, body: content };
}

function renderTemplateFile(template: NoteTemplate): string {
	const fm = stringifyYaml({
		id: template.id,
		name: template.name,
		insertMode: template.insertMode,
		newFileFolder: template.newFileFolder,
		newFileNameTemplate: template.newFileNameTemplate,
	}).replace(/\n+$/, '');
	return `---\n${fm}\n---\n${template.prompt}\n`;
}

function sanitizeFilename(name: string): string {
	const cleaned = name.replace(/[\\/:*?"<>|]/g, '-').trim();
	return cleaned || 'Untitled';
}

function normalizeFolderPath(folderPath: string): string {
	const trimmed = folderPath.trim();
	if (!trimmed) return '';
	const normalized = normalizePath(trimmed);
	if (!normalized || normalized === '/' || normalized === '.') return '';
	return normalized;
}
