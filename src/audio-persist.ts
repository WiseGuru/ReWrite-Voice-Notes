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
	const path = await resolveTargetPath(app, filename, settings.attachmentsFolderPath);
	const buffer = await blob.arrayBuffer();
	await app.vault.createBinary(path, buffer);
	return path;
}

async function resolveTargetPath(app: App, filename: string, configuredFolder: string): Promise<string> {
	const folder = configuredFolder.trim();
	if (folder) {
		await ensureFolder(app, folder);
		const normalized = normalizePath(`${folder}/${filename}`);
		return await deCollide(app, normalized);
	}
	const fm = (app as unknown as { fileManager?: AttachmentFileManager }).fileManager;
	if (fm?.getAvailablePathForAttachment) {
		return await fm.getAvailablePathForAttachment(filename);
	}
	return await deCollide(app, normalizePath(filename));
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
