import { NoteTemplate } from '../types';

// Each default template carries only its per-template rules. The shared cleanup
// preface (anti-injection guardrail + condensed cleanup + output discipline)
// lives in the vault SharedCore.md file (see src/shared-core.ts) and is
// prepended by the pipeline at runtime, so it is NOT baked in here. A template
// can opt out by setting `disableSharedCore: true` in its frontmatter.
const DEFAULT_TEMPLATES: NoteTemplate[] = [
	{
		id: 'tpl-default-general-cleanup',
		name: 'General cleanup',
		prompt:
			`Produce natural-sounding written prose that preserves the speaker's meaning, structure, and approximate length.

Detailed rules:
- Remove "like" used as a filler or hedge ("is like a tool that"). Keep "like" when it means "similar to" or is a verb.
- Remove sentence-initial "So," and "And" when they are conversational openers with no logical force. Keep them mid-sentence when they actually connect ideas.
- Remove softening hedges that don't add meaning ("kind of", "sort of", "relatively", "basically", "pretty much") when they modify a clear factual statement. Keep them when they signal genuine uncertainty.
- Collapse stacked hedges: when two or more chain together ("I should probably try to"), reduce to at most one, or remove entirely if the statement is clearly a plan or intent.
- "Actually" used for emphasis is NOT a self-correction; keep it.
- Break up run-on sentences, especially long chains joined by "and".
- When the speaker restates a phrase with a near-synonym in the same breath ("the plans, the things I want to do"), keep only the clearer or more specific version.
- Rejoin sentences the transcriber split mid-phrase, and drop abandoned fragments from mid-sentence pivots, keeping the completed thought.
- Numbers and dates in standard written forms (January 15, 2026 / $300 / 5:30 PM); small conversational numbers can stay as words.
- Reconstruct broken phrases from context; never output a polished sentence that says nothing coherent.
- Use bullets, numbered lists, or paragraph breaks only when they genuinely improve readability. Do not over-format.`,
		insertMode: 'cursor',
		newFileFolder: '',
		newFileNameTemplate: 'ReWrite {{date}} {{time}}',
	},
	{
		id: 'tpl-default-todo-list',
		name: 'Todo list',
		prompt:
			`Produce a Markdown checkbox list of every actionable task mentioned, one per line as "- [ ] ". When the transcript spans multiple topics, group related tasks under "##" subheadings; otherwise emit a flat list. Keep each task concise but specific: capture the action plus any stated owner or due date. Do not invent tasks that were not spoken.`,
		insertMode: 'cursor',
		newFileFolder: '',
		newFileNameTemplate: 'ReWrite {{date}} {{time}}',
	},
	{
		id: 'tpl-default-daily-note',
		name: 'Daily note',
		prompt:
			`Lay the transcript into a daily note using these "##" sections in order:

## Calendar
Scheduled events with their date or time, as bullets. Omit this heading if none.

## Goals
Strategic directions or longer-term intentions the speaker expressed, as bullets. Omit this heading if none.

## Tasks
Concrete, achievable actions, as a checkbox list ("- [ ] "). Omit this heading if none.

## Braindump
The entire cleaned transcript, as prose or bullet points, whichever fits. Drop nothing of substance here.

Goals, Tasks, and Calendar are extracted from what the speaker actually said in the braindump; do not invent items. The Braindump section is always present.`,
		insertMode: 'newFile',
		newFileFolder: 'Daily Notes',
		newFileNameTemplate: '{{date}}',
	},
	{
		id: 'tpl-default-meeting-notes',
		name: 'Meeting notes',
		prompt:
			`Restructure the transcript into meeting notes using these "##" sections, omitting any the transcript doesn't cover: Attendees, Summary, Action items, Decisions. Format Action items as a Markdown checkbox list ("- [ ] "), including the owner when one was stated. Keep Summary to 2-4 sentences. Do not invent attendees, actions, or decisions.`,
		insertMode: 'newFile',
		newFileFolder: 'Meetings',
		newFileNameTemplate: 'Meeting {{date}} {{time}}',
	},
	{
		id: 'tpl-default-idea-capture',
		name: 'Idea capture',
		prompt:
			`Preserve the raw ideas faithfully: do not summarize, abridge, reorder, or invent connections between them. Prepend a single one-sentence summary of the core idea at the very top, followed by a blank line, then the cleaned ideas.`,
		insertMode: 'append',
		newFileFolder: '',
		newFileNameTemplate: 'Idea {{date}} {{time}}',
	},
	{
		id: 'tpl-default-lecture',
		name: 'Lecture',
		prompt:
			`Restructure this single-speaker transcript into structured notes using these "##" sections, omitting any the transcript does not cover: Summary, Key concepts, Definitions, Examples, Open questions, References. Keep Summary to 2-4 sentences capturing the lecture's thesis. Under Key concepts, list each major idea as a bullet with one or two sentences of explanation. Capture Definitions as "term: definition" bullets. Do not invent material the speaker did not say.`,
		insertMode: 'newFile',
		newFileFolder: 'Lectures',
		newFileNameTemplate: 'Lecture {{date}} {{time}}',
	},
	{
		id: 'tpl-default-podcast',
		name: 'Podcast',
		prompt:
			`Restructure the transcript into structured notes using these "##" sections, omitting any the transcript does not cover: Summary, Speakers, Topics discussed, Notable quotes, References mentioned, Takeaways. Keep Summary to 2-4 sentences. Under Speakers, list each distinct voice and what they bring (host, guest, role) when stated. Format Notable quotes as 'Speaker: "quote"' lines when the transcript includes speaker labels; when it does not, attribute generically ("one speaker noted that..."). Capture References as books, papers, people, or URLs a listener might follow up on. Do not invent speakers, attributions, or references.`,
		insertMode: 'newFile',
		newFileFolder: 'Podcasts',
		newFileNameTemplate: 'Podcast {{date}} {{time}}',
	},
];

export function freshDefaultTemplates(): NoteTemplate[] {
	return DEFAULT_TEMPLATES.map((t) => ({ ...t }));
}
