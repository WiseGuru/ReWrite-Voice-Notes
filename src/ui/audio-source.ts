import { App, Notice, TAbstractFile, TFile } from 'obsidian';
import type ReWritePlugin from '../main';
import { NoteTemplate } from '../types';
import { resolveActiveProfile } from '../platform';
import { runPipeline } from '../pipeline';
import { AUDIO_EXTENSIONS, extensionToMime } from '../audio-persist';
import { isProfileConfigured } from './setup-card';
import { ReWriteModal } from './modal';

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
): Promise<void> {
	const settings = plugin.settings;
	const { profile } = resolveActiveProfile(settings);
	if (plugin.encryptionStatus.locked) {
		new Notice('ReWrite: API keys are locked. Unlock to reprocess audio.');
		plugin.promptUnlock();
		return;
	}
	if (!isProfileConfigured(profile)) {
		new Notice('ReWrite: configure a transcription and LLM provider before reprocessing audio.');
		new ReWriteModal(plugin.app, plugin).open();
		return;
	}
	const progress = new Notice('ReWrite: reprocessing audio...', 0);
	try {
		const blob = await readAudioFileAsBlob(plugin.app, file);
		await runPipeline({
			app: plugin.app,
			settings,
			host: plugin,
			profile,
			template,
			source: { kind: 'audio', audio: blob, sourcePath: file.path },
		});
		progress.hide();
		plugin.settings.lastUsedTemplateId = template.id;
		await plugin.saveSettings();
		new Notice('ReWrite complete.');
	} catch (e) {
		progress.hide();
		const message = e instanceof Error ? e.message : String(e);
		new Notice(`ReWrite: ${message}`);
	}
}
