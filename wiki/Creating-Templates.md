# Creating templates

Templates control how a transcript is cleaned and structured, and where the result goes. They are plain Markdown files in your vault, so you edit, rename, reorder, and create them like any other note.

This page is the canonical guide to the template format. The settings tab links here from its Templates section.

## Anatomy of a template

Each template is one `.md` file in your templates folder (default `ReWrite/Templates/`):

```markdown
---
id: my-meeting-notes
name: Meeting notes
insertMode: newFile
newFileFolder: Meetings
newFileNameTemplate: Meeting {{date}} {{title}}
disableSharedCore:
enableContextHint: true
diarize:
titleFromContent: true
noteProperties:
  subject: One short line naming the meeting's topic.
  participants: Comma-separated list of people present.
  date: The meeting date if stated, else today.
---

Turn the transcript into concise meeting notes. Use these sections, omitting any with no content:

## Summary
## Decisions
## Action items
```

- **Frontmatter** (between the `---` lines) configures the template.
- **Body** (everything after) is the prompt sent to the LLM.

Files are sorted by filename in the modal and pickers, so prefix names with `01-`, `02-`, etc. to control order. The frontmatter `id` is the identity, so renaming a file does not break the default-template or last-used references.

## Frontmatter fields

| Field | Type | Purpose |
| --- | --- | --- |
| `id` | string | Stable identity. Keep it unique; do not reuse across templates. |
| `name` | string | Display name in the modal and pickers. |
| `insertMode` | `cursor` / `newFile` / `append` | Where the output goes (see below). |
| `newFileFolder` | string | Folder for `newFile` output. |
| `newFileNameTemplate` | string | Filename pattern for `newFile`, supports `{{date}}`, `{{time}}`, `{{title}}`. |
| `disableSharedCore` | boolean | Set `true` to skip the shared core for this template (opt-out). |
| `enableContextHint` | boolean | Set `true` to show the one-off Context field for this template (opt-in). |
| `diarize` | boolean | Set `true` to force speaker labels on (only effective on diarization-capable providers). |
| `titleFromContent` | boolean | Set `true` to have the LLM name the new file from the content. |
| `noteProperties` | map | Frontmatter properties the LLM fills from the content (key = property name, value = instruction). `newFile` only. |

Note the polarity difference: `disableSharedCore` is an opt-out (set it to turn the shared core OFF for this template), while `enableContextHint`, `diarize`, and `titleFromContent` are opt-ins (set them to turn a feature ON). Populate always writes the four boolean keys as empty stubs so they are discoverable; an empty value means "not set". Obsidian's Properties UI may store an edited boolean as text, so the parser accepts both `true` and the string `"true"`.

## Insert modes

- **`cursor`**: inserts at the cursor in the active note. Falls back to `append` when no editor is open.
- **`append`**: appends to the current Markdown note. Falls back to `newFile` when no note is open.
- **`newFile`**: writes a new note in `newFileFolder`, named by `newFileNameTemplate`.

Filename tokens (newFile): `{{date}}` and `{{time}}` expand via Obsidian's date formatting; `{{title}}` expands to the LLM-generated title when `titleFromContent` is on (and collapses cleanly when absent). Collisions are resolved per your "On filename collision" setting.

The per-run Destination control in the modal can override the insert mode for a single run without editing the template on disk.

## The shared core

`ReWrite/SharedCore.md` holds baseline cleanup rules (an anti-injection guardrail, general grammar/filler cleanup, and output discipline). At cleanup time the plugin prepends it to your template prompt, so the assembled system prompt reads: shared core, then template prompt, then any spoken ad-hoc instructions, then the context hint, then known nouns, then note-properties instructions.

Because the shared core is shared, write your template prompt to describe only what is special about this template (the sections, the tone, the format). Do not repeat general cleanup rules. Delete or empty `SharedCore.md` to disable it everywhere; set `disableSharedCore: true` to disable it for one template. A template that opts out runs without the anti-injection guardrail, so the settings tab flags any such template.

## Note properties

For `newFile` templates, `noteProperties` asks the LLM to emit a leading YAML block that becomes the note's frontmatter. Author it as a YAML map (property name to instruction). The key order drives both the prompt and the written order. Properties are written only in `newFile` mode (never into an existing note). Example:

```yaml
noteProperties:
  podcast: The show name.
  episode: Episode number or title if stated.
  host: The host's name.
  guests: Comma-separated guest names.
```

## Note title

`titleFromContent: true` asks the LLM to generate a title for the new file. It rides the same leading YAML block as note properties (under a reserved key) but is used only for the filename, never written as a frontmatter property. Use it with a `{{title}}` token in `newFileNameTemplate` (for example `Meeting {{date}} {{title}}`), or with no token, in which case the title becomes the whole filename. The plugin hardens the model's output into a safe filename and falls back to the static name if nothing usable remains.

## Writing a good prompt

1. **Describe the shape, not the cleanup.** The shared core already handles grammar and fillers. Spend the prompt on structure.
2. **Name your sections explicitly.** "Use these sections: ## Summary, ## Decisions, ## Action items" beats a vague "summarize".
3. **Be concrete about format.** If you want a checklist, say "a Markdown checklist with `- [ ]` items".
4. **Extract, do not invent.** Tell the model to leave a section out when there is nothing for it, rather than padding.
5. **Keep it short.** A focused prompt outperforms a long one. One template, one job.
6. **Test and iterate.** Run it on a real transcript and adjust the wording.

## Keeping templates up to date

The Templates section has three buttons (see [Settings reference](Settings-Reference)):

- **Populate**: adds any missing default templates plus the shared core and guide. Never overwrites your files.
- **Update**: reconciles your default-derived templates with the current built-ins using a per-field 3-way merge. Pristine fields (never edited, matching a current or previously shipped default) are brought forward; your edits are kept. Anything it cannot auto-merge (notably an edited prompt body that diverges from a changed default) is written to `Template update report.md` next to the templates folder for you to review. Re-serializing frontmatter drops any YAML comments you added; the prompt body is left untouched.
- **Load prior versions**: writes earlier shipped versions of the defaults as standalone, separately-named templates so you can compare prompt wording. They never collide with your live templates.

## Cross-references

- [Providers](Providers) for diarization, context hints, and known nouns, which interact with templates.
- [Settings reference](Settings-Reference) for the Templates, Shared core, and Known nouns settings.

[Back to Home](Home)
