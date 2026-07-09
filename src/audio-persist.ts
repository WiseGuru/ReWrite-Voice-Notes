import { App, moment, normalizePath } from 'obsidian';
import { GlobalSettings } from './types';

interface AttachmentFileManager {
	getAvailablePathForAttachment(filename: string, sourcePath?: string): Promise<string>;
}

export const AUDIO_EXTENSIONS = ['mp3', 'wav', 'm4a', 'webm', 'ogg', 'flac', 'mp4'] as const;

export function extensionToMime(ext: string): string {
	const clean = ext.toLowerCase().replace(/^\./, '');
	switch (clean) {
		case 'webm':
			return 'audio/webm';
		case 'ogg':
			return 'audio/ogg';
		case 'm4a':
		case 'mp4':
			return 'audio/mp4';
		case 'wav':
			return 'audio/wav';
		case 'mp3':
			return 'audio/mpeg';
		case 'flac':
			return 'audio/flac';
		default:
			return 'application/octet-stream';
	}
}

export function mimeToExtension(mime: string): string {
	const base = (mime.split(';')[0] ?? '').trim().toLowerCase();
	switch (base) {
		case 'audio/webm':
			return 'webm';
		case 'audio/ogg':
			return 'ogg';
		case 'audio/mp4':
			return 'm4a';
		case 'audio/wav':
		case 'audio/wave':
		case 'audio/x-wav':
			return 'wav';
		case 'audio/mpeg':
		case 'audio/mp3':
			return 'mp3';
		default:
			return 'webm';
	}
}

export function buildAudioFilename(now: Date, ext: string): string {
	const stamp = moment(now).format('YYYY-MM-DD-HHmmss');
	return `ReWrite-${stamp}.${ext}`;
}

export async function persistAudio(app: App, blob: Blob, settings: GlobalSettings): Promise<string> {
	const ext = mimeToExtension(blob.type);
	const filename = buildAudioFilename(new Date(), ext);
	const path = await resolveAttachmentPath(app, filename, settings.attachmentsFolderPath);
	const buffer = await blob.arrayBuffer();
	await app.vault.createBinary(path, buffer);
	return path;
}

// Where a recording lands: the configured attachments folder (with manual
// de-collision) when set, otherwise Obsidian's own attachments setting via
// getAvailablePathForAttachment. Exported so the auto-ingest mover resolves the
// same destination a live recording would get. `sourcePath` (the note the
// attachment belongs to) lets a note-relative attachment setting resolve
// correctly; it is harmless for the recording flow (no note yet). The parent
// folder of the resolved path is always created, because a caller that MOVES a
// file into it via `fileManager.renameFile` (auto-ingest) fails when the folder
// is missing (unlike `vault.create` / `createBinary`, rename does not create
// intermediate folders).
export async function resolveAttachmentPath(
	app: App,
	filename: string,
	configuredFolder: string,
	sourcePath = '',
): Promise<string> {
	const folder = configuredFolder.trim();
	if (folder) {
		await ensureFolder(app, folder);
		const normalized = normalizePath(`${folder}/${filename}`);
		return await deCollide(app, normalized);
	}
	const fm = (app as unknown as { fileManager?: AttachmentFileManager }).fileManager;
	if (fm?.getAvailablePathForAttachment) {
		const resolved = await fm.getAvailablePathForAttachment(filename, sourcePath);
		await ensureParentFolder(app, resolved);
		return resolved;
	}
	return await deCollide(app, normalizePath(filename));
}

// The folder a recording WOULD be stored in, resolved the same way as
// resolveAttachmentPath but WITHOUT creating anything (no ensureFolder). Auto-ingest
// uses this to detect, before processing a file, that a rule's folder is also the
// attachments destination (which would make the move a pointless in-place rename and
// re-ingest the file every run). `sourcePath` lets a note-relative attachment setting
// resolve representatively (pass a path in the note's target folder).
export async function resolveAttachmentFolder(
	app: App,
	configuredFolder: string,
	sourcePath = '',
): Promise<string> {
	const folder = configuredFolder.trim();
	if (folder) return normalizePath(folder);
	const fm = (app as unknown as { fileManager?: AttachmentFileManager }).fileManager;
	if (fm?.getAvailablePathForAttachment) {
		const resolved = normalizePath(await fm.getAvailablePathForAttachment('rewrite-probe.webm', sourcePath));
		return resolved.includes('/') ? resolved.slice(0, resolved.lastIndexOf('/')) : '';
	}
	return '';
}

async function ensureParentFolder(app: App, filePath: string): Promise<void> {
	const normalized = normalizePath(filePath);
	const slash = normalized.lastIndexOf('/');
	if (slash <= 0) return; // vault root: nothing to create
	await ensureFolder(app, normalized.slice(0, slash));
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

async function deCollide(app: App, path: string): Promise<string> {
	if (!app.vault.getAbstractFileByPath(path)) return path;
	const dot = path.lastIndexOf('.');
	const stem = dot > path.lastIndexOf('/') ? path.slice(0, dot) : path;
	const ext = dot > path.lastIndexOf('/') ? path.slice(dot) : '';
	for (let n = 1; n < 1000; n++) {
		const candidate = `${stem}-${n}${ext}`;
		if (!app.vault.getAbstractFileByPath(candidate)) return candidate;
	}
	throw new Error(`Could not find a free filename near ${path}.`);
}
