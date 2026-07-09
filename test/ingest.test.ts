import { describe, expect, it } from 'vitest';
import { collectIngestFiles, ingestTargetIsSameFolder, isIngestTemplate, normalizeIngestFolder } from '../src/ingest';
import { NoteTemplate } from '../src/types';
import { TFile, TFolder } from '../test/mocks/obsidian';

function template(overrides: Partial<NoteTemplate> = {}): NoteTemplate {
	return {
		id: 'tpl',
		name: 'Template',
		prompt: 'p',
		insertMode: 'newFile',
		newFileFolder: '',
		newFileNameTemplate: '{{title}}',
		...overrides,
	};
}

function audioFile(name: string, ext: string): TFile {
	const f = new TFile();
	f.path = `Inbox/${name}.${ext}`;
	f.name = `${name}.${ext}`;
	f.basename = name;
	f.extension = ext;
	return f;
}

describe('isIngestTemplate', () => {
	it('accepts a newFile template', () => {
		expect(isIngestTemplate(template())).toBe(true);
	});

	// Unattended ingest has no active editor: cursor falls back to append, append
	// to newFile, so only explicit newFile templates are eligible.
	it('rejects cursor and append templates', () => {
		expect(isIngestTemplate(template({ insertMode: 'cursor' }))).toBe(false);
		expect(isIngestTemplate(template({ insertMode: 'append' }))).toBe(false);
	});

	it('rejects a missing template', () => {
		expect(isIngestTemplate(undefined)).toBe(false);
	});
});

describe('collectIngestFiles', () => {
	it('collects only audio files, sorted by name', () => {
		const folder = new TFolder();
		const md = new TFile();
		md.path = 'Inbox/note.md';
		md.extension = 'md';
		folder.children = [audioFile('b-rec', 'mp3'), md, audioFile('a-rec', 'm4a')];
		const files = collectIngestFiles(folder as never);
		expect(files.map((f) => f.basename)).toEqual(['a-rec', 'b-rec']);
	});

	// Direct children only: a subfolder the user organizes into must never be
	// swept up (TFolder children that are folders are not TFile instances).
	it('ignores subfolders', () => {
		const folder = new TFolder();
		const sub = new TFolder();
		sub.children = [audioFile('nested', 'mp3')];
		folder.children = [sub, audioFile('top', 'wav')];
		const files = collectIngestFiles(folder as never);
		expect(files.map((f) => f.basename)).toEqual(['top']);
	});

	it('returns empty for a folder with no audio', () => {
		const folder = new TFolder();
		folder.children = [];
		expect(collectIngestFiles(folder as never)).toEqual([]);
	});
});

describe('ingestTargetIsSameFolder', () => {
	// The reprocess-loop guard: when the attachment target resolves into the folder the file
	// is already in, the move is refused (a local review flagged this comparison).
	it('is true when the target folder equals the file parent folder', () => {
		expect(ingestTargetIsSameFolder('Inbox/rec.mp3', 'Inbox')).toBe(true);
		expect(ingestTargetIsSameFolder('a/b/rec.mp3', 'a/b')).toBe(true);
	});

	it('is false when the target is a different folder', () => {
		expect(ingestTargetIsSameFolder('Attachments/rec.mp3', 'Inbox')).toBe(false);
		expect(ingestTargetIsSameFolder('Inbox/sub/rec.mp3', 'Inbox')).toBe(false);
	});

	it('treats vault root ("/" or "") consistently', () => {
		// A root-level target and a root-level file are the same folder.
		expect(ingestTargetIsSameFolder('rec.mp3', '')).toBe(true);
		expect(ingestTargetIsSameFolder('rec.mp3', '/')).toBe(true);
		// A root file but a subfolder target is a real move.
		expect(ingestTargetIsSameFolder('Attachments/rec.mp3', '')).toBe(false);
		expect(ingestTargetIsSameFolder('Attachments/rec.mp3', '/')).toBe(false);
	});
});

describe('normalizeIngestFolder', () => {
	// The up-front misconfiguration check (rule folder equals the recordings folder)
	// compares folders through this normalizer, so a trailing slash or a root variant
	// must not read as a different folder.
	it('treats the vault root variants as one empty root', () => {
		expect(normalizeIngestFolder('')).toBe('');
		expect(normalizeIngestFolder('/')).toBe('');
		expect(normalizeIngestFolder('   ')).toBe('');
	});

	it('trims whitespace and a trailing slash', () => {
		expect(normalizeIngestFolder(' Attachments ')).toBe('Attachments');
		expect(normalizeIngestFolder('Attachments/')).toBe('Attachments');
		expect(normalizeIngestFolder('a/b/')).toBe('a/b');
	});

	it('leaves an already-clean folder unchanged, so equal folders compare equal', () => {
		expect(normalizeIngestFolder('Voice Inbox')).toBe('Voice Inbox');
		expect(normalizeIngestFolder('Voice Inbox/')).toBe(normalizeIngestFolder('Voice Inbox'));
	});
});
