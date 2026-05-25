import { App, Editor, MarkdownView, Notice } from 'obsidian';
import type ReWritePlugin from '../main';
import { NoteTemplate } from '../types';
import { resolveActiveProfile } from '../platform';
import { runPipeline } from '../pipeline';
import { isProfileConfiguredForText } from './setup-card';
import { ReWriteModal } from './modal';

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
	if (!isProfileConfiguredForText(profile)) {
		new Notice('ReWrite: configure an LLM provider before processing text.');
		new ReWriteModal(plugin.app, plugin).open();
		return;
	}
	const progress = new Notice('ReWrite: processing text...', 0);
	try {
		await runPipeline({
			app: plugin.app,
			settings,
			profile,
			template,
			source: { kind: 'text', text },
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
