import { App, normalizePath, TFile } from 'obsidian';

export const DEFAULT_ASSISTANT_PROMPT = 'The user spoke these instructions mid-dictation. Apply each one as you produce the final text:';

const DEFAULT_FILE_BODY = `${DEFAULT_ASSISTANT_PROMPT}\n`;

export async function loadAssistantPromptFromFile(app: App, path: string): Promise<string | null> {
	const normalized = normalizeFilePath(path);
	if (!normalized) return null;
	const file = app.vault.getAbstractFileByPath(normalized);
	if (!(file instanceof TFile)) return null;
	try {
		const content = await app.vault.read(file);
		const { body } = splitFrontmatter(content);
		const trimmed = body.trim();
		return trimmed.length > 0 ? trimmed : null;
	} catch {
		return null;
	}
}

export async function populateDefaultAssistantPrompt(app: App, path: string): Promise<boolean> {
	const normalized = normalizeFilePath(path);
	if (!normalized) throw new Error('Assistant prompt path is empty.');
	if (app.vault.getAbstractFileByPath(normalized)) return false;
	const parent = parentFolder(normalized);
	if (parent) await ensureFolder(app, parent);
	await app.vault.create(normalized, DEFAULT_FILE_BODY);
	return true;
}

export function isPathAssistantPrompt(path: string, configuredPath: string): boolean {
	const normalizedConfigured = normalizeFilePath(configuredPath);
	if (!normalizedConfigured) return false;
	return normalizePath(path) === normalizedConfigured;
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

function normalizeFilePath(path: string): string {
	const trimmed = path.trim();
	if (!trimmed) return '';
	const normalized = normalizePath(trimmed);
	if (!normalized || normalized === '/' || normalized === '.') return '';
	return normalized;
}

function parentFolder(path: string): string {
	const idx = path.lastIndexOf('/');
	if (idx <= 0) return '';
	return path.slice(0, idx);
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
