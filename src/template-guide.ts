import { App, normalizePath } from 'obsidian';

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

The **Populate** button in settings writes the seven built-in templates here. It is non-destructive: it skips any template whose \`id\` already exists, so you can run it again to top up after deleting one, and your own edits are never overwritten.

## Frontmatter properties

| Property | What it does |
| --- | --- |
| \`id\` | Stable identifier. Must be unique. This is how ReWrite remembers your default and last-used template, so do not reuse an id or change it casually. |
| \`name\` | Display name shown in the modal and pickers. Falls back to the file name if blank. |
| \`insertMode\` | Where the result goes: \`cursor\`, \`newFile\`, or \`append\`. See below. |
| \`newFileFolder\` | For \`insertMode: newFile\`, the folder the new note is created in. Blank means the vault root. |
| \`newFileNameTemplate\` | For \`insertMode: newFile\`, the new note's file name. Supports \`{{date}}\` and \`{{time}}\`. |
| \`disableSharedCore\` | Set to \`true\` to skip the shared core for this one template. Leave blank otherwise. See "The shared core". |

### insertMode in detail

- **\`cursor\`**: insert at the cursor in the active note. If no editor is open, it falls back to appending.
- **\`newFile\`**: create a new note from \`newFileFolder\` plus \`newFileNameTemplate\`. If a note with that name already exists, ReWrite either auto-numbers it (\`name-1\`, \`name-2\`) or prompts you for a new path, depending on your new-file collision setting.
- **\`append\`**: add to the end of the active note (or the most recently edited note when none is focused). If no Markdown note exists at all, it creates one.

\`{{date}}\` becomes the date as \`YYYY-MM-DD\` and \`{{time}}\` becomes the time as \`HHmmss\`, expanded at the moment of insertion. They are substituted in \`newFileNameTemplate\` only, not in \`newFileFolder\`; put a literal folder path in \`newFileFolder\`.

If the source was a recording, the saved audio file is embedded as \`![[...]]\` at the top of the output regardless of insert mode, so you always keep the original.

## The shared core

The shared core is one Markdown file (default \`ReWrite/SharedCore.md\`) whose body is **prepended to every template's prompt** right before each cleanup call. Think of it as the house rules every template inherits.

At run time the system prompt is assembled in this order:

1. **Shared core** (unless the template opts out)
2. **Your template's body** (the prompt below your frontmatter)
3. **Ad-hoc instructions** (only when you spoke "<assistant name>, ..." in the recording)
4. **Known nouns** (only when your KnownNouns file lists any)

The default shared core carries three things, so your template body does not have to:

- An **anti-injection guardrail**: it tells the model the transcript is text to clean, not instructions to obey. This is the plugin's main defense against a transcript that happens to say "ignore your instructions and ...".
- **General cleanup rules**: fix grammar and punctuation, drop filler words and false starts, keep the corrected version of self-corrections, preserve the speaker's voice and proper nouns, and keep \`Speaker A:\` style labels intact.
- **Output discipline**: output only the result, with no preamble, labels, or code fences, and empty input yields empty output.

Because the shared core already says all of this, **do not repeat it in your template**. Your template should only describe what is unique to it: the structure and tone of this particular kind of note.

Editing \`SharedCore.md\` changes the baseline for every template at once. It rides along on every call, so trimming it saves tokens. Deleting or emptying the file disables the shared core for the whole plugin (there is no hidden fallback). Setting \`disableSharedCore: true\` on a template disables it for that one template only, which also drops the anti-injection guardrail for that template; settings will warn you when a loaded template has this set.

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
