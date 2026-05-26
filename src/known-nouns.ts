import { App, normalizePath, TFile } from 'obsidian';
import { KnownNoun } from './types';

const DEFAULT_FILE_BODY = `---
guidance: |
  Keep this list focused on nouns the LLM keeps mangling, not your whole personal
  glossary. Every entry rides along on every cleanup call, so an unbounded list
  inflates token usage on every recording. Add words only when the LLM has
  actually misheard or rewritten them; remove entries that have stopped being
  a problem.

  Format: one noun per line. Optionally add a colon followed by comma-separated
  misheard variants so the LLM knows what to correct from.
---

Hoxhunt: hawks hunt, hocks hunt
Tofugu: toe fugue
`;

export async function loadKnownNounsFromFile(app: App, path: string): Promise<KnownNoun[]> {
	const normalized = normalizeFilePath(path);
	if (!normalized) return [];
	const file = app.vault.getAbstractFileByPath(normalized);
	if (!(file instanceof TFile)) return [];
	try {
		const content = await app.vault.read(file);
		const { body } = splitFrontmatter(content);
		return parseKnownNounsBody(body);
	} catch {
		return [];
	}
}

export async function populateDefaultKnownNouns(app: App, path: string): Promise<boolean> {
	const normalized = normalizeFilePath(path);
	if (!normalized) throw new Error('Known nouns path is empty.');
	if (app.vault.getAbstractFileByPath(normalized)) return false;
	const parent = parentFolder(normalized);
	if (parent) await ensureFolder(app, parent);
	await app.vault.create(normalized, DEFAULT_FILE_BODY);
	return true;
}

export function isPathKnownNouns(path: string, configuredPath: string): boolean {
	const normalizedConfigured = normalizeFilePath(configuredPath);
	if (!normalizedConfigured) return false;
	return normalizePath(path) === normalizedConfigured;
}

export function buildKnownNounsSystemPromptSection(nouns: KnownNoun[]): string {
	if (nouns.length === 0) return '';
	const lines = nouns.map((n) => {
		if (n.alternates.length === 0) return `- ${n.canonical}`;
		return `- ${n.canonical} (also: ${n.alternates.join(', ')})`;
	});
	return [
		'## Known nouns',
		"The following proper nouns appear in the user's vocabulary. Preserve them verbatim; if you see a likely-misheard variant, correct it to the canonical form.",
		...lines,
	].join('\n');
}

function parseKnownNounsBody(body: string): KnownNoun[] {
	const out: KnownNoun[] = [];
	for (const raw of body.split(/\r?\n/)) {
		const line = raw.trim();
		if (!line) continue;
		if (line.startsWith('#')) continue;
		const colonIdx = line.indexOf(':');
		if (colonIdx === -1) {
			out.push({ canonical: line, alternates: [] });
			continue;
		}
		const canonical = line.slice(0, colonIdx).trim();
		if (!canonical) continue;
		const altsRaw = line.slice(colonIdx + 1);
		const alternates = altsRaw
			.split(',')
			.map((s) => s.trim())
			.filter((s) => s.length > 0);
		out.push({ canonical, alternates });
	}
	return out;
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
