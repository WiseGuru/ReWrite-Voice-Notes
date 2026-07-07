import { App, Notice, TAbstractFile, TFile } from 'obsidian';
import type ReWritePlugin from '../main';
import { NoteTemplate } from '../types';
import { resolveActiveProfile } from '../platform';
import { AUDIO_EXTENSIONS, extensionToMime } from '../audio-persist';
import { isProfileConfigured } from './setup-card';
import { ReWriteModal } from './modal';
import { runBackgroundPipeline } from './pipeline-progress';

const AUDIO_EXT_SET: ReadonlySet<string> = new Set<string>(AUDIO_EXTENSIONS);

export function isAudioFile(file: TAbstractFile | null | undefined): file is TFile {
	if (!file || !(file instanceof TFile)) return false;
	return AUDIO_EXT_SET.has(file.extension.toLowerCase());
}

export function collectAudioFiles(app: App): TFile[] {
	return app.vault.getFiles().filter((f) => isAudioFile(f));
}

export async function readAudioFileAsBlob(app: App, file: TFile): Promise<Blob> {
	const buffer = await app.vault.readBinary(file);
	return new Blob([buffer], { type: extensionToMime(file.extension) });
}

export async function runAudioFilePipeline(
	plugin: ReWritePlugin,
	template: NoteTemplate,
	file: TFile,
	contextHint?: string,
): Promise<void> {
	const settings = plugin.settings;
	const { profile } = resolveActiveProfile(settings);
	if (plugin.encryptionStatus.locked) {
		new Notice('ReWrite: API keys are locked. Unlock to reprocess audio.');
		plugin.promptUnlock();
		return;
	}
	if (profile.transcriptionProvider === 'none') {
		new Notice('ReWrite: transcription is disabled for this profile. Pick a transcription provider in settings to reprocess audio.');
		return;
	}
	if (!isProfileConfigured(profile)) {
		new Notice('ReWrite: configure a transcription and LLM provider before reprocessing audio.');
		new ReWriteModal(plugin.app, plugin).open();
		return;
	}
	let blob: Blob;
	try {
		blob = await readAudioFileAsBlob(plugin.app, file);
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		new Notice(`ReWrite: ${message}`);
		return;
	}
	await runBackgroundPipeline(
		plugin,
		{
			app: plugin.app,
			settings,
			host: plugin,
			profile,
			template,
			source: { kind: 'audio', audio: blob, sourcePath: file.path },
			contextHint: contextHint?.trim() || undefined,
		},
		{ startMessage: 'ReWrite: reprocessing audio...', templateId: template.id },
	);
}
