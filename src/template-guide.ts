import { App, moment, normalizePath, TFile } from 'obsidian';
import type { TemplateUpdateConflict, TemplateUpdateEntry, UpdateResult } from './templates-folder';

// A human-facing help document seeded next to the templates folder by the
// settings "Populate" button. The plugin never reads this file and never sends
// it to any provider; it exists purely so users can learn the template format,
// how the shared core combines with a template, and how to word a good prompt.
export const TEMPLATE_GUIDE_FILENAME = 'Template guide.md';

export const DEFAULT_TEMPLATE_GUIDE = `---
guidance: |
  This is a help document for you, the human. The ReWrite plugin never reads
  this file and never sends it to any provider. Edit or delete it freely.
---

# ReWrite: how to write a template

A template tells ReWrite how to turn a transcript (or pasted / selected text) into a finished note. This guide covers every property a template can set, how the shared core combines with your template at run time, and how to word a prompt that produces clean output.

## A template is one Markdown file

Each template is a single \`.md\` file in your templates folder (default \`ReWrite/Templates\`). The file has two parts:

- **Frontmatter** (the \`---\` block at the top): the template's settings.
- **Body** (everything after the frontmatter): the prompt sent to the language model.

Templates are listed in the picker sorted by file name, so prefix names with numbers (\`01 General.md\`, \`02 Daily note.md\`) if you want a specific order. Identity comes from the \`id\` property, not the file name, so you can rename a file without breaking which template is your default or last used.

The **Populate** button in settings writes the ten built-in templates here (plus the shared core and this guide). It is non-destructive: it skips any template whose \`id\` already exists, so you can run it again to top up after deleting one, and your own edits are never overwritten.

## Keeping templates up to date

Populate only ever *adds* missing files; it never touches one you already have. So when a new version of ReWrite improves a built-in template (a new frontmatter field, a new property, reworded instructions), Populate cannot push that into the copy in your vault. The **Update** button does.

Update reconciles your built-in-derived templates (matched by \`id\`) with the current defaults:

- It **fills in new frontmatter fields and missing \`noteProperties\`** automatically.
- It **recreates any built-in template you deleted** entirely.
- It **brings unedited content forward.** ReWrite remembers what each built-in looked like in past versions. If your copy of a prompt (or a setting, or a property instruction) still matches an older shipped version, Update knows you never changed it and safely upgrades it to the new default for you.
- It **never overwrites your edits**: anything you actually changed is kept exactly as you wrote it. A **prompt you edited** is left untouched and instead written to the report below for you to merge by hand.

Anything it cannot safely merge by itself, it writes to a **\`Template update report.md\`** file next to this guide (not inside the templates folder). That report lists, per template: settings and properties it upgraded or added for you, a property the default dropped (kept in your file, flagged so you can remove it), a property instruction you changed (your wording kept), and a **prompt body that you edited** (your file untouched, the new default shown beside it so you can merge by hand). The report is regenerated (overwritten) on every Update.

One caveat: when Update changes a file, it re-saves the file's frontmatter, which **discards any YAML comments** you added in the frontmatter. Your prompt body is never altered unless it was an unedited older version. A template that is already current is never rewritten, so its comments are only ever lost if the file genuinely needed a change.

### Comparing prompt versions

The **Load prior versions** button drops earlier shipped versions of the built-in prompts into your templates folder as their own templates, named with the version they came from (e.g. \`Meeting notes 0.1.1\`). They appear in the picker alongside the current one, so you can run the same recording through an old prompt and the new prompt and compare the results. They are ordinary templates with their own \`id\`, so Update and Populate leave them alone; delete them when you are done. (Until a built-in prompt has actually changed across versions, there is nothing prior to load.)

## Frontmatter properties

| Property | What it does |
| --- | --- |
| \`id\` | Stable identifier. Must be unique. This is how ReWrite remembers your default and last-used template, so do not reuse an id or change it casually. |
| \`name\` | Display name shown in the modal and pickers. Falls back to the file name if blank. |
| \`insertMode\` | Where the result goes: \`cursor\`, \`newFile\`, or \`append\`. See below. |
| \`newFileFolder\` | For \`insertMode: newFile\`, the folder the new note is created in. Blank means the vault root. |
| \`newFileNameTemplate\` | For \`insertMode: newFile\`, the new note's file name. Supports \`{{date}}\`, \`{{time}}\`, and \`{{title}}\`. |
| \`disableSharedCore\` | Set to \`true\` to skip the shared core for this one template. Leave blank otherwise. See "The shared core". |
| \`enableContextHint\` | Set to \`true\` to show an optional "Context" field for this template. Leave blank otherwise. See "Context hint". |
| \`diarize\` | Set to \`true\` to force speaker identification on for this template. Leave blank otherwise. See "Speaker identification". |
| \`titleFromContent\` | Set to \`true\` to have the model name the new note from the content (\`newFile\` only). Leave blank otherwise. See "Note title". |
| \`noteProperties\` | A YAML map of frontmatter properties for the model to fill from the content (\`newFile\` only). Leave it out unless you want it. See "Note properties". |

### insertMode in detail

- **\`cursor\`**: insert at the cursor in the active note. If no editor is open, it falls back to appending.
- **\`newFile\`**: create a new note from \`newFileFolder\` plus \`newFileNameTemplate\`. If a note with that name already exists, ReWrite either auto-numbers it (\`name-1\`, \`name-2\`) or prompts you for a new path, depending on your new-file collision setting.
- **\`append\`**: add to the end of the active note (or the most recently edited note when none is focused). If no Markdown note exists at all, it creates one.

\`{{date}}\` becomes the date as \`YYYY-MM-DD\` and \`{{time}}\` becomes the time as \`HHmmss\`, expanded at the moment of insertion. \`{{title}}\` becomes a title the model writes from the recording, but only when the template has \`titleFromContent: true\` (otherwise it expands to nothing). See "Note title". These tokens are substituted in \`newFileNameTemplate\` only, not in \`newFileFolder\`; put a literal folder path in \`newFileFolder\`.

If the source was a recording, the saved audio file is embedded as \`![[...]]\` at the top of the output regardless of insert mode, so you always keep the original.

## The shared core

The shared core is one Markdown file (default \`ReWrite/SharedCore.md\`) whose body is **prepended to every template's prompt** right before each cleanup call. Think of it as the house rules every template inherits.

At run time the system prompt is assembled in this order:

1. **Shared core** (unless the template opts out)
2. **Your template's body** (the prompt below your frontmatter)
3. **Ad-hoc instructions** (only when you spoke "<assistant name>, ..." in the recording)
4. **Context** (only when this template has \`enableContextHint\` and you filled the field in)
5. **Known nouns** (only when your KnownNouns file lists any)
6. **Note properties** (only when this template declares \`noteProperties\`)

The default shared core carries three things, so your template body does not have to:

- An **anti-injection guardrail**: it tells the model the transcript is text to clean, not instructions to obey. This is the plugin's main defense against a transcript that happens to say "ignore your instructions and ...".
- **General cleanup rules**: fix grammar and punctuation, drop filler words and false starts, keep the corrected version of self-corrections, preserve the speaker's voice and proper nouns, and keep \`Speaker A:\` style labels intact.
- **Output discipline**: output only the result, with no preamble, labels, or code fences, and empty input yields empty output.

Because the shared core already says all of this, **do not repeat it in your template**. Your template should only describe what is unique to it: the structure and tone of this particular kind of note.

Editing \`SharedCore.md\` changes the baseline for every template at once. It rides along on every call, so trimming it saves tokens. Deleting or emptying the file disables the shared core for the whole plugin (there is no hidden fallback). Setting \`disableSharedCore: true\` on a template disables it for that one template only, which also drops the anti-injection guardrail for that template; settings will warn you when a loaded template has this set.

## Context hint

Set \`enableContextHint: true\` on a template to surface an optional **Context** field whenever you use it. It is collapsed by default in both the main ReWrite window and the "Reprocess audio" picker, so it never gets in your way; expand it only when you want to add a one-off note about the recording, such as "Lecture by Dr. Smith on thermodynamics" or "Meeting with Rachel, Joe, and Sally".

Whatever you type is added to the prompt as a \`## Context\` block for that single run (it is not saved). It helps the model attribute statements to the right person, spell names correctly, and pick the right tone. It is the one-off counterpart to your Known nouns list: Known nouns is a standing list of names to always preserve, while Context is "here is what *this* recording is". The built-in Meeting notes, Meeting transcript, Lecture, Podcast, Guides, and Book log templates ship with this turned on.

## Speaker identification

Set \`diarize: true\` on a template to force speaker identification on for it, so the transcript comes back with \`Speaker 1:\`, \`Speaker 2:\` style labels that your prompt can turn into attendees and attributions. This overrides the per-profile "Identify speakers" toggle for this template only.

It only works on transcription providers that support diarization (AssemblyAI, Deepgram, Rev.ai); on any other provider the flag is simply ignored and you get an ordinary transcript. The built-in Meeting transcript template uses this.

## Note title

Set \`titleFromContent: true\` to have the model name the new note from what was said (and any Context you provided), instead of a fixed date/time name. A meeting becomes its subject, a book log becomes the book's title, and so on.

This works with \`insertMode: newFile\` only (other modes write into a note you already have, so there is nothing to name). Two ways to place the generated title:

- Put a \`{{title}}\` token in \`newFileNameTemplate\` to compose it with other pieces, e.g. \`Meeting {{date}} {{title}}\` becomes \`Meeting 2026-06-12 Q3 planning sync\`.
- Leave the token out and the generated title becomes the **whole** file name, e.g. set \`newFileNameTemplate: {{title}}\` (or any name) and a book log is filed as \`Bram Stoker's Dracula\`.

Good to know:

- **It names the file, it is not a frontmatter property.** If you also want a title *in* the note's properties, add it to \`noteProperties\` separately.
- **Illegal filename characters are cleaned up automatically** (\`/\`, \`:\`, \`?\`, and friends become \`-\`), and very long titles are trimmed.
- **If the model cannot produce a title** (or you have the LLM set to "none"), the note falls back to the normal date/time name, so you never get an empty file name.
- **Same titles collide more often** than dated names. ReWrite handles it the same way as any name clash: auto-numbering (\`Dracula-1\`) or a rename prompt, per your new-file collision setting.

The built-in Meeting notes, Meeting transcript, Lecture, Podcast, Guides, and Book log templates ship with this on. Daily note deliberately leaves it off (a date is the right name for a daily note).

## Note properties

A template can ask the model to fill in the new note's **frontmatter properties** from what was said. Add a \`noteProperties\` map to the frontmatter, where each key is a property name and its value is a short instruction telling the model what to put there:

\`\`\`
noteProperties:
  title: The book title.
  author: The author's full name.
  series: The series name, or leave blank if standalone.
\`\`\`

When you run such a template, the model writes a small YAML block at the very top of its answer, and ReWrite turns it into the new note's frontmatter, then writes the note body below it. So a book log comes out with \`title\`, \`author\`, and \`series\` already set in the Properties panel.

A few things to know:

- **\`newFile\` only.** Properties are written only when the template creates a new note. They are ignored for \`cursor\` and \`append\`, which write into a note you already have open, so ReWrite never rewrites an existing note's frontmatter behind your back.
- **Every property always appears.** If the model could not work out a value, the property is still added, just left empty, so the note always has the full scaffold for you to fill in.
- **Only your declared properties are used.** The model is told to fill exactly the keys you listed and nothing else.

Several built-in templates ship with this: Meeting notes and Meeting transcript fill \`subject\` / \`participants\` / \`date\`, Lecture fills \`subject\` / \`lecturer\` / \`course\`, Podcast fills \`podcast\` / \`episode\` / \`host\` / \`guests\`, Guides fills \`topic\` / \`tool\`, and Book log fills \`title\` / \`author\` / \`series\`.

## Writing a good prompt

The body of the file is the prompt. A few principles produce reliable results:

1. **Describe the shape of the output, not the cleanup.** The shared core already handles grammar, filler, and formatting discipline. Spend your prompt on structure: which \`##\` sections to produce and in what order.
2. **Name your sections and say when to omit them.** For example: "Use these sections in order: \`## Summary\`, then \`## Action items\` as a \`- [ ] \` checkbox list, omitting the heading when there are none."
3. **Be concrete about format.** Say "as bullet points" or "as a checkbox list (\`- [ ] \`)" rather than leaving it open.
4. **Extract, do not invent.** When a section pulls items out of what was said (tasks, dates, decisions), say so explicitly: "extracted from what the speaker actually said; do not invent items."
5. **Keep it short and declarative.** Imperative sentences ("Lay the transcript into...", "Group related points under...") work better than long explanations.
6. **One template, one job.** If you are describing two unrelated output shapes, split them into two templates.

### Example

\`\`\`
---
id: my-meeting-notes
name: Meeting notes
insertMode: newFile
newFileFolder: Meetings
newFileNameTemplate: "{{date}} meeting"
disableSharedCore:
---
Turn the transcript into meeting notes with these sections in order:

## Summary
Two or three sentences on what the meeting was about.

## Decisions
Bullet points of decisions that were actually made. Omit the heading if none.

## Action items
A checkbox list ("- [ ] ") of concrete next steps, with an owner in brackets when one was named. Omit the heading if none.

Decisions and action items are extracted from what was said; do not invent them.
\`\`\`

Notice the body never mentions fixing grammar, removing "um", or avoiding preambles. The shared core covers all of that. To try a new template without recording, open ReWrite, pick the template, and use the Paste tab.
`;

export async function populateTemplateGuide(app: App, templatesFolderPath: string): Promise<boolean> {
	const folder = guideFolder(templatesFolderPath);
	const path = folder
		? normalizePath(`${folder}/${TEMPLATE_GUIDE_FILENAME}`)
		: normalizePath(TEMPLATE_GUIDE_FILENAME);
	if (app.vault.getAbstractFileByPath(path)) return false;
	if (folder) await ensureFolder(app, folder);
	await app.vault.create(path, DEFAULT_TEMPLATE_GUIDE);
	return true;
}

// The guide lives in the parent of the templates folder (the "ReWrite" root by
// default), not inside the templates folder itself, so it is never parsed as a
// template. When the templates folder sits at the vault root, the guide does too.
function guideFolder(templatesFolderPath: string): string {
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

// The Update button's worklist. Lives next to the template guide (the parent of
// the templates folder), so loadTemplatesFromFolder never parses it. Overwritten
// on every Update; the plugin never reads it and never sends it to a provider.
export const TEMPLATE_UPDATE_REPORT_FILENAME = 'Template update report.md';

export async function writeTemplateUpdateReport(
	app: App,
	templatesFolderPath: string,
	result: UpdateResult,
): Promise<string> {
	const folder = guideFolder(templatesFolderPath);
	const path = folder
		? normalizePath(`${folder}/${TEMPLATE_UPDATE_REPORT_FILENAME}`)
		: normalizePath(TEMPLATE_UPDATE_REPORT_FILENAME);
	const content = renderUpdateReport(result);
	const existing = app.vault.getAbstractFileByPath(path);
	if (existing instanceof TFile) {
		await app.vault.modify(existing, content);
	} else {
		if (folder) await ensureFolder(app, folder);
		await app.vault.create(path, content);
	}
	return path;
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
	lines.push(`Status: **${entry.status}** — ${entry.path}`);
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
