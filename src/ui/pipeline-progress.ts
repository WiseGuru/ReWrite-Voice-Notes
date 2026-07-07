import { Notice } from 'obsidian';
import type ReWritePlugin from '../main';
import { PipelineParams, PipelineStage, runPipeline } from '../pipeline';

// Notice.noticeEl is the element to append a Cancel button into, but the installed typings mark
// it deprecated in favor of messageEl/containerEl, which only exist since Obsidian 1.8.7 (newer
// than this plugin's minAppVersion 1.4.4). Reached through a narrow cast, mirroring the
// hotkeyManager/secretStorage pattern elsewhere in this codebase for API surfaces the public
// typings don't cleanly expose across the supported version range.
interface NoticeElementLike {
	noticeEl: HTMLElement;
}
function noticeContainer(notice: Notice): HTMLElement {
	return (notice as unknown as NoticeElementLike).noticeEl;
}

export function stageLabel(stage: PipelineStage): string {
	switch (stage) {
		case 'persist-audio':
			return 'Saving audio...';
		case 'transcribe':
			return 'Transcribing...';
		case 'cleanup':
			return 'Cleaning up...';
		case 'insert':
			return 'Inserting...';
	}
}

export function formatDuration(ms: number): string {
	const total = Math.max(0, Math.floor(ms / 1000));
	const minutes = Math.floor(total / 60);
	const seconds = total % 60;
	return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

// Runs a pipeline in the background behind a sticky Notice that shows live stage progress and a
// Cancel button. Obsidian's requestUrl has no AbortSignal, so cancel only takes effect between
// network calls, not mid-transfer; it still stops a pipeline that would otherwise sit at a hung
// stage with no way to end it short of reloading the plugin. On success, saves lastUsedTemplateId.
// On error (including a user cancel, which surfaces as an AbortError), shows the failure message
// and calls the optional onError hook so a caller can react further (e.g. Quick Record reopening
// the main modal on a captured-audio failure).
export async function runBackgroundPipeline(
	plugin: ReWritePlugin,
	params: Omit<PipelineParams, 'onStage' | 'signal'>,
	opts: { startMessage: string; templateId: string; onError?: (message: string) => void },
): Promise<void> {
	const controller = new AbortController();
	const progress = new Notice(opts.startMessage, 0);
	const cancelBtn = noticeContainer(progress).createEl('button', { text: 'Cancel', cls: 'rewrite-notice-cancel' });
	cancelBtn.addEventListener('click', () => controller.abort());
	try {
		await runPipeline({
			...params,
			signal: controller.signal,
			onStage: (stage) => progress.setMessage(`ReWrite: ${stageLabel(stage)}`),
		});
		progress.hide();
		plugin.settings.lastUsedTemplateId = opts.templateId;
		await plugin.saveSettings();
		new Notice('ReWrite complete.');
	} catch (e) {
		progress.hide();
		const message = e instanceof Error ? e.message : String(e);
		new Notice(`ReWrite: ${message}`);
		opts.onError?.(message);
	}
}
