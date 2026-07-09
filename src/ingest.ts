import { Notice, TFile, TFolder, normalizePath } from 'obsidian';
import type ReWritePlugin from './main';
import { runPipeline } from './pipeline';
import { resolveActiveProfile } from './platform';
import { resolveAttachmentFolder, resolveAttachmentPath } from './audio-persist';
import { isAudioFile, readAudioFileAsBlob } from './ui/audio-source';
import { isProfileConfigured } from './ui/setup-card';
import { IngestRule, NoteTemplate } from './types';

// Notice.noticeEl cast, mirroring pipeline-progress.ts (messageEl/containerEl only
// exist since Obsidian 1.8.7, newer than minAppVersion).
interface NoticeElementLike {
	noticeEl: HTMLElement;
}

export interface IngestBatchSummary {
	processed: number;
	failed: number;
	skippedRules: number;
	canceled: boolean;
}

// One unit of work: an audio file paired with the template of the rule whose
// folder it was found in.
interface IngestWorkItem {
	file: TFile;
	template: NoteTemplate;
}

// A rule is runnable only when its template still exists AND targets a new file.
// Unattended ingest has no active editor, so cursor/append would silently cascade
// into newFile anyway; requiring newFile makes the destination explicit. Exported
// for tests and reused by the rule-editor dropdown filter.
export function isIngestTemplate(template: NoteTemplate | undefined): template is NoteTemplate {
	return !!template && template.insertMode === 'newFile';
}

// Direct children of the rule folder only (no recursion): predictable scope, and
// a user's organized subfolders are never swept up by accident.
export function collectIngestFiles(folder: TFolder): TFile[] {
	const files: TFile[] = [];
	for (const child of folder.children) {
		if (isAudioFile(child)) files.push(child);
	}
	files.sort((a, b) => a.name.localeCompare(b.name));
	return files;
}

// Scan every enabled ingest rule and run each found audio file through the
// pipeline with the rule's template, serialized one at a time. Move-on-success is
// the dedupe mechanism: a processed file is moved to the attachments location (via
// fileManager.renameFile, which rewrites the just-created note's embed link), so a
// re-run never reprocesses it; a failed file stays put for the next run.
export async function runIngestBatch(plugin: ReWritePlugin): Promise<IngestBatchSummary | null> {
	const settings = plugin.settings;
	const { profile } = resolveActiveProfile(settings);

	const rules = settings.ingestRules.filter((r) => r.enabled);
	if (rules.length === 0) {
		new Notice('ReWrite: no enabled auto-ingest folders. Add one in settings.');
		return null;
	}
	if (plugin.encryptionStatus.locked) {
		new Notice('ReWrite: API keys are locked. Unlock to process ingest folders.');
		plugin.promptUnlock();
		return null;
	}
	if (profile.transcriptionProvider === 'none') {
		new Notice('ReWrite: transcription is disabled for this profile. Pick a transcription provider in settings.');
		return null;
	}
	if (!isProfileConfigured(profile)) {
		new Notice('ReWrite: configure a transcription and LLM provider before processing ingest folders.');
		return null;
	}

	const { items, skippedRules } = await collectWork(plugin, rules);
	if (items.length === 0) {
		new Notice(skippedRules > 0
			? `ReWrite: no audio files to ingest (${skippedRules} rule${skippedRules === 1 ? '' : 's'} skipped; check folders and templates).`
			: 'ReWrite: no audio files found in the ingest folders.');
		return { processed: 0, failed: 0, skippedRules, canceled: false };
	}

	const controller = new AbortController();
	const progress = new Notice(`ReWrite: ingesting ${items.length} file${items.length === 1 ? '' : 's'}...`, 0);
	const cancelBtn = (progress as unknown as NoticeElementLike).noticeEl
		.createEl('button', { text: 'Cancel', cls: 'rewrite-notice-cancel' });
	cancelBtn.addEventListener('click', () => controller.abort());

	let processed = 0;
	let canceled = false;
	// Keep the actual reason each file failed so the user (and logs) can see WHY,
	// rather than only a bare "N failed" count.
	const failures: Array<{ name: string; message: string }> = [];
	try {
		for (let i = 0; i < items.length; i++) {
			if (controller.signal.aborted) {
				canceled = true;
				break;
			}
			const item = items[i];
			if (!item) continue;
			progress.setMessage(`ReWrite: ingesting ${i + 1}/${items.length} — ${item.file.name}`);
			try {
				await ingestOne(plugin, item, controller.signal);
				processed++;
			} catch (e) {
				if (e instanceof DOMException && e.name === 'AbortError') {
					canceled = true;
					break;
				}
				const message = e instanceof Error ? e.message : String(e);
				failures.push({ name: item.file.name, message });
				console.error(`ReWrite: ingest failed for ${item.file.path}`, e);
			}
		}
	} finally {
		progress.hide();
	}

	const failed = failures.length;
	const failNote = failed > 0 ? `, ${failed} failed (left in place for the next run)` : '';
	const cancelNote = canceled ? ' Canceled; remaining files stay put.' : '';
	new Notice(`ReWrite: ingest done. ${processed} processed${failNote}.${cancelNote}`);
	// Surface the concrete failure reasons in their own sticky notice so a failed
	// batch is diagnosable without opening the developer console.
	if (failed > 0) {
		const lines = failures.slice(0, 5).map((f) => `• ${f.name}: ${f.message}`);
		if (failed > 5) lines.push(`…and ${failed - 5} more (see the developer console).`);
		new Notice(`ReWrite: ingest errors —\n${lines.join('\n')}`, 15_000);
	}
	return { processed, failed, skippedRules, canceled };
}

async function collectWork(plugin: ReWritePlugin, rules: IngestRule[]): Promise<{ items: IngestWorkItem[]; skippedRules: number }> {
	const items: IngestWorkItem[] = [];
	const seenPaths = new Set<string>();
	let skippedRules = 0;
	for (const rule of rules) {
		const template = plugin.templates.find((t) => t.id === rule.templateId);
		if (!isIngestTemplate(template)) {
			skippedRules++;
			new Notice(`ReWrite: ingest rule for "${rule.folderPath}" skipped. Its template is missing or does not create a new file.`);
			continue;
		}
		const folder = plugin.app.vault.getAbstractFileByPath(normalizePath(rule.folderPath.trim()));
		if (!(folder instanceof TFolder)) {
			skippedRules++;
			new Notice(`ReWrite: ingest folder "${rule.folderPath}" not found; rule skipped.`);
			continue;
		}
		// Reject the misconfiguration where the rule folder is ALSO where recordings are
		// stored, up front (before creating any note): the post-processing move would then
		// be a pointless in-place rename and the file would be re-ingested every run. The
		// destination is resolved representatively for this template's note folder; the
		// move-time guard in moveIngestedFile stays as a per-file backstop.
		const noteFolder = (template.newFileFolder ?? '').trim();
		const probeNotePath = normalizePath(`${noteFolder ? `${noteFolder}/` : ''}rewrite-probe.md`);
		const destFolder = await resolveAttachmentFolder(plugin.app, plugin.settings.attachmentsFolderPath, probeNotePath);
		if (normalizeIngestFolder(destFolder) === normalizeIngestFolder(folder.path)) {
			skippedRules++;
			new Notice(`ReWrite: ingest rule for "${rule.folderPath}" skipped. This folder is also where recordings are stored, so processed files would stay put and be re-ingested every run. Point the rule at a different folder, or set a distinct Attachments folder in Recording settings.`);
			continue;
		}
		for (const file of collectIngestFiles(folder)) {
			// Two rules pointing at the same folder must not queue a file twice.
			if (seenPaths.has(file.path)) continue;
			seenPaths.add(file.path);
			items.push({ file, template });
		}
	}
	return { items, skippedRules };
}

async function ingestOne(plugin: ReWritePlugin, item: IngestWorkItem, signal: AbortSignal): Promise<void> {
	const settings = plugin.settings;
	const { profile } = resolveActiveProfile(settings);
	const blob = await readAudioFileAsBlob(plugin.app, item.file);
	// sourcePath skips the persist stage and reuses the existing file for the
	// ![[embed]] prepend, exactly like the manual reprocess flow.
	const result = await runPipeline({
		app: plugin.app,
		settings,
		host: plugin,
		profile,
		template: item.template,
		source: { kind: 'audio', audio: blob, sourcePath: item.file.path },
		signal,
	});
	// Last step, only after the note was created: move the recording in with the
	// other voice recordings. renameFile rewrites the just-created note's embed to
	// the new path, so the link stays valid. A pipeline failure before this point
	// leaves the file in the ingest folder to be retried next run. A failure of the
	// move itself is reported distinctly, because the note DID get created, so the
	// user must move/delete the source manually to avoid a duplicate next run.
	try {
		await moveIngestedFile(plugin, item.file, result.insert.path);
	} catch (e) {
		const reason = e instanceof Error ? e.message : String(e);
		throw new Error(`note created, but the recording could not be moved out of the ingest folder (${reason}). Move or delete "${item.file.name}" yourself so the next run does not process it again.`);
	}
}

async function moveIngestedFile(plugin: ReWritePlugin, file: TFile, notePath?: string): Promise<void> {
	// Pass the just-created note as the source path so a note-relative attachment
	// setting resolves near it; resolveAttachmentPath also creates the destination
	// folder (renameFile, unlike vault.create, will not).
	const target = normalizePath(await resolveAttachmentPath(plugin.app, file.name, plugin.settings.attachmentsFolderPath, notePath ?? ''));
	// If the destination folder is the folder the file already sits in (the ingest
	// folder IS the attachments location), moving is pointless — the de-collision
	// would just rename it in place and the next run would reprocess it. Surface
	// that misconfiguration instead of quietly churning files.
	if (ingestTargetIsSameFolder(target, file.parent?.path ?? '')) {
		throw new Error('its attachments location is the same folder it is already in; point the ingest rule at a different folder, or set a distinct Attachments folder in settings');
	}
	await plugin.app.fileManager.renameFile(file, target);
}

// Normalize a folder path for equality comparison: strip a trailing slash and treat the
// vault root ('/' from Obsidian, or '') as the same empty root. Pure + exported for tests.
export function normalizeIngestFolder(path: string): string {
	const trimmed = (path ?? '').trim();
	if (trimmed === '' || trimmed === '/') return '';
	return trimmed.replace(/\/+$/, '');
}

// Whether the resolved attachment target lands in the same folder the file already sits in.
// When it does, moving is a no-op de-collision rename and the file would be reprocessed every
// run, so the caller treats it as an error. Compares folder portions, treating the vault root
// ('/' or '') as the same empty root. Pure + exported for tests (this is the comparison a
// local review flagged as worth pinning down).
export function ingestTargetIsSameFolder(targetPath: string, fileParentPath: string): boolean {
	const targetParent = targetPath.includes('/') ? targetPath.slice(0, targetPath.lastIndexOf('/')) : '';
	return normalizeIngestFolder(targetParent) === normalizeIngestFolder(fileParentPath);
}
