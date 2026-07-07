import { App, Editor, MarkdownView, Notice } from 'obsidian';
import type ReWritePlugin from '../main';
import { NoteTemplate } from '../types';
import { resolveActiveProfile } from '../platform';
import { isProfileConfiguredForText } from './setup-card';
import { ReWriteModal } from './modal';
import { runBackgroundPipeline } from './pipeline-progress';

export interface TextResolution {
	text: string;
	scope: 'selection' | 'note';
}

export function resolveTextFromEditor(editor: Editor): TextResolution {
	const selection = editor.getSelection();
	if (selection) return { text: selection, scope: 'selection' };
	return { text: editor.getValue(), scope: 'note' };
}

export function resolveActiveTextSource(app: App): TextResolution | null {
	const view = app.workspace.getActiveViewOfType(MarkdownView);
	if (!view) return null;
	return resolveTextFromEditor(view.editor);
}

export async function runTextPipeline(
	plugin: ReWritePlugin,
	template: NoteTemplate,
	text: string,
): Promise<void> {
	const settings = plugin.settings;
	const { profile } = resolveActiveProfile(settings);
	if (plugin.encryptionStatus.locked) {
		new Notice('ReWrite: API keys are locked. Unlock to process text.');
		plugin.promptUnlock();
		return;
	}
	if (!isProfileConfiguredForText(profile)) {
		new Notice('ReWrite: configure an LLM provider before processing text.');
		new ReWriteModal(plugin.app, plugin).open();
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
			source: { kind: 'text', text },
		},
		{ startMessage: 'ReWrite: processing text...', templateId: template.id },
	);
}
