import { App, moment, normalizePath, TFile } from 'obsidian';
import type { TemplateUpdateConflict, TemplateUpdateEntry, UpdateResult } from './templates-folder';

// The Update button's worklist. Lives next to the templates folder (in its
// parent, the "ReWrite" root by default), so loadTemplatesFromFolder never
// parses it. Overwritten on every Update; the plugin never reads it back and
// never sends it to a provider. User-facing help about the template format now
// lives in the project wiki (Creating templates), not a seeded vault file.
export const TEMPLATE_UPDATE_REPORT_FILENAME = 'Template update report.md';

export async function writeTemplateUpdateReport(
	app: App,
	templatesFolderPath: string,
	result: UpdateResult,
): Promise<string> {
	const folder = reportFolder(templatesFolderPath);
	const path = folder
		? normalizePath(`${folder}/${TEMPLATE_UPDATE_REPORT_FILENAME}`)
		: normalizePath(TEMPLATE_UPDATE_REPORT_FILENAME);
	const content = renderUpdateReport(result);
	const existing = app.vault.getAbstractFileByPath(path);
	if (existing instanceof TFile) {
		await app.vault.process(existing, () => content);
	} else {
		if (folder) await ensureFolder(app, folder);
		await app.vault.create(path, content);
	}
	return path;
}

// The report lives in the parent of the templates folder (the "ReWrite" root by
// default), not inside the templates folder itself, so it is never parsed as a
// template. When the templates folder sits at the vault root, the report does too.
function reportFolder(templatesFolderPath: string): string {
	const normalized = normalizeFolderPath(templatesFolderPath);
	if (!normalized) return '';
	const idx = normalized.lastIndexOf('/');
	if (idx <= 0) return '';
	return normalized.slice(0, idx);
}

function normalizeFolderPath(folderPath: string): string {
	const trimmed = folderPath.trim();
	if (!trimmed) return '';
	const normalized = normalizePath(trimmed);
	if (!normalized || normalized === '/' || normalized === '.') return '';
	return normalized;
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

// Fenced block in the report. Tilde fences so a prompt containing ``` does not
// break it; an indented fence inside the user content is harmless either way.
function reportBlock(label: string, value: string): string[] {
	return [`**${label}:**`, '~~~text', value, '~~~', ''];
}

function renderConflict(c: TemplateUpdateConflict): string[] {
	switch (c.kind) {
		case 'body':
			return [
				'### Prompt body differs',
				'',
				'Your file\'s prompt was kept. The current default is shown for comparison; merge by hand if you want the new wording.',
				'',
				...reportBlock('Your file', c.userValue ?? ''),
				...reportBlock('Default now', c.defaultValue ?? ''),
			];
		case 'removedProperty': {
			const safety = c.wasShippedDefault
				? ' It still matches the instruction the default shipped, so it is stale default cruft and safe to delete.'
				: ' This looks like one you added, so it was left alone.';
			return [
				`### Property \`${c.detail}\` is no longer in the default`,
				'',
				`It was kept in your file. Delete it if you no longer want it.${safety} Its instruction: ${c.userValue || '(blank)'}`,
				'',
			];
		}
		case 'changedInstruction':
			return [
				`### Property \`${c.detail}\` instruction differs`,
				'',
				'Your wording was kept.',
				'',
				...reportBlock('Your file', c.userValue ?? ''),
				...reportBlock('Default now', c.defaultValue ?? ''),
			];
		case 'parseFailed':
			return [
				'### Could not be parsed',
				'',
				'This file\'s `id` is a default id but the file could not be parsed (invalid frontmatter). It was left untouched. Fix the YAML and run Update again.',
				'',
			];
	}
}

function renderUpdateReport(result: UpdateResult): string {
	const lines: string[] = [];
	lines.push('---');
	lines.push('guidance: |');
	lines.push('  This is a worklist for you, the human. The ReWrite plugin never reads this');
	lines.push('  file and never sends it to any provider. It is overwritten every time you');
	lines.push('  click Update, so copy anything you want to keep elsewhere.');
	lines.push('---');
	lines.push('');
	lines.push('# ReWrite: template update report');
	lines.push('');
	const failNote = result.parseFailed ? `, ${result.parseFailed} could not be parsed` : '';
	lines.push(`Generated ${moment().format('YYYY-MM-DD HH:mm')}. ${result.updated} updated, ${result.conflicts} need manual review, ${result.created} created, ${result.unchanged} unchanged${failNote}.`);
	lines.push('');

	const actionable = result.entries.filter((e) => e.status !== 'unchanged');
	if (actionable.length === 0) {
		lines.push('Nothing needed attention.');
	}
	for (const entry of actionable) {
		lines.push(...renderEntry(entry));
	}

	lines.push('---');
	lines.push('');
	lines.push('This report is regenerated (overwritten) every time you click Update and is never read by the plugin or sent to any provider. Note that Update re-saves the frontmatter of any file it changes, which discards YAML comments in the frontmatter; your prompt text is left exactly as you wrote it.');
	lines.push('');
	return lines.join('\n');
}

function renderEntry(entry: TemplateUpdateEntry): string[] {
	const lines: string[] = [];
	lines.push(`## ${entry.name} (\`${entry.id}\`)`);
	lines.push('');
	lines.push(`Status: **${entry.status}** - ${entry.path}`);
	lines.push('');
	if (entry.changes.length > 0) {
		lines.push('Applied automatically:');
		for (const change of entry.changes) lines.push(`- ${change}`);
		lines.push('');
	}
	for (const conflict of entry.conflicts) {
		lines.push(...renderConflict(conflict));
	}
	return lines;
}
