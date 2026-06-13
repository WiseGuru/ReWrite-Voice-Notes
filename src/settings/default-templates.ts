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
			`Produce natural-sounding written prose that preserves the speaker's meaning, structure, and full length. This is a cleanup pass, NOT a summary: every distinct point, step, example, caveat, number, and named detail in the input must survive in the output. You are removing disfluencies and redundancy, never information. If the input is long, the output should be comparably long.

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
		newFileNameTemplate: 'Meeting {{date}} {{title}}',
		enableContextHint: true,
		titleFromContent: true,
		noteProperties: [
			{ name: 'subject', instruction: 'A short subject line for the meeting.' },
			{ name: 'participants', instruction: 'Comma-separated list of attendees, or leave blank if none are named.' },
			{ name: 'date', instruction: 'The meeting date (e.g. 2026-06-12), or leave blank if not stated.' },
		],
	},
	{
		id: 'tpl-default-meeting-transcript',
		name: 'Meeting transcript',
		prompt:
			`Restructure the transcript into meeting notes using these "##" sections, omitting any the transcript doesn't cover: Attendees, Summary, Action items, Decisions. The transcript includes "Speaker X:" labels; use them to populate Attendees and to attribute action items and decisions to the right person, replacing the generic labels with real names when the context makes them clear. Format Action items as a Markdown checkbox list ("- [ ] "), naming the owner when one is identifiable. Keep Summary to 2-4 sentences. Do not invent attendees, actions, or decisions.`,
		insertMode: 'newFile',
		newFileFolder: 'Meetings',
		newFileNameTemplate: 'Meeting {{date}} {{title}}',
		enableContextHint: true,
		diarize: true,
		titleFromContent: true,
		noteProperties: [
			{ name: 'subject', instruction: 'A short subject line for the meeting.' },
			{ name: 'participants', instruction: 'Comma-separated list of attendees, using real names where the speaker labels make them identifiable; leave blank if none.' },
			{ name: 'date', instruction: 'The meeting date (e.g. 2026-06-12), or leave blank if not stated.' },
		],
	},
	{
		id: 'tpl-default-idea-capture',
		name: 'Idea capture',
		prompt:
			`Capture every distinct idea and its supporting details faithfully: do not summarize, abridge, merge, reorder, or invent connections between them. Keep all specifics (names, numbers, examples, steps, and caveats) exactly as expressed, in the order the speaker presented them. The result is a complete, lightly cleaned record of everything said, not a digest. Prepend a single one-sentence summary of the core idea at the very top, followed by a blank line, then the cleaned ideas.`,
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
		newFileNameTemplate: 'Lecture {{date}} {{title}}',
		enableContextHint: true,
		titleFromContent: true,
		noteProperties: [
			{ name: 'subject', instruction: "The lecture's topic or title." },
			{ name: 'lecturer', instruction: "The speaker's name, if stated; otherwise leave blank." },
			{ name: 'course', instruction: 'The course or series this lecture belongs to, if mentioned.' },
		],
	},
	{
		id: 'tpl-default-podcast',
		name: 'Podcast',
		prompt:
			`Restructure the transcript into structured notes using these "##" sections, omitting any the transcript does not cover: Summary, Speakers, Topics discussed, Notable quotes, References mentioned, Takeaways. Keep Summary to 2-4 sentences. Under Speakers, list each distinct voice and what they bring (host, guest, role) when stated. Format Notable quotes as 'Speaker: "quote"' lines when the transcript includes speaker labels; when it does not, attribute generically ("one speaker noted that..."). Capture References as books, papers, people, or URLs a listener might follow up on. Do not invent speakers, attributions, or references.`,
		insertMode: 'newFile',
		newFileFolder: 'Podcasts',
		newFileNameTemplate: '{{title}}',
		enableContextHint: true,
		titleFromContent: true,
		noteProperties: [
			{ name: 'podcast', instruction: 'The name of the podcast.' },
			{ name: 'episode', instruction: 'The episode title or number, if mentioned.' },
			{ name: 'host', instruction: "The host's name, if stated; otherwise leave blank." },
			{ name: 'guests', instruction: 'Comma-separated list of guests or interviewees, or leave blank if none.' },
		],
	},
	{
		id: 'tpl-default-guides',
		name: 'Guides',
		prompt:
			`You convert transcribed spoken walkthroughs into clean, sequential documentation steps. The input is a raw transcript of someone narrating how to use an application or tool while they demonstrate it. Your output is documentation-ready instructions a writer can paste with minimal editing.

RULES

Fidelity over completeness. Use only what the transcript states. Never invent UI labels, menu paths, button names, keyboard shortcuts, or steps that were not described. If a step is clearly implied but its specifics are missing, insert a bracketed placeholder like [unspecified: exact menu name] rather than guessing.

Preserve literal values exactly. Commands, filenames, URLs, code, and any text the speaker says to type or enter must be reproduced verbatim, not paraphrased. If the speaker spells a command out in words, render the literal token only when unambiguous; otherwise flag it in the Gaps section.

Reorder into logical sequence. Speakers backtrack and self-correct ("actually, before that..."). Resolve these into the correct final order and drop the false starts. If a correction revises an earlier step, apply it and keep only the corrected version.

Strip speech artifacts. Remove filler (um, uh, like, you know, basically, so), restarts, and asides with no instructional content. Do NOT remove substantive caveats, warnings, or conditions.

Convert to imperative voice. "So I'm going to click Save" becomes "Click Save." Address the reader as the one performing the action.

Separate actions from explanation. Each step is one discrete action. Put rationale, warnings, and "why" context in a Note beneath the relevant step, not inside the step text.

Handle ambiguous references. Walkthroughs lean on what's on screen ("click here," "this one"). When the referent is recoverable from surrounding context, name it. When it is not, keep the action but mark the target: "Click [target unclear from transcript]."

Preserve branches and conditions. If the speaker gives alternatives ("if you're on Mac, instead..."), keep them as labeled conditional steps, not merged into one.

OUTPUT FORMAT

Output valid Obsidian-flavored Markdown only, structured so it renders cleanly with no literal list markers showing as plain text.

- Begin with a Markdown H1 title naming the task (e.g. "# SSO and SCIM setup").
- End with a "## Gaps" H2 section: a bulleted list of everything ambiguous, missing, spelled-out, or assumed, so the writer knows exactly what to verify.
- Put caveats and rationale on their own line as "**Note:** ..." (bold label), indented to match the content they belong to.

LIST FORMATTING (follow exactly)

- Use at most TWO levels: top-level steps, and one level of sub-steps beneath a step. Never nest a third level. If content seems to need a third level, flatten it: promote it to its own top-level step, or fold it into the parent line.
- Top-level steps: an ordered list, one action per line, marked "1.", "2.", "3.", ... each starting at the left margin with no indentation.
- Sub-steps: a bulleted list marked with "-", each line indented by exactly ONE TAB character (never spaces) beneath its parent step.
- One marker style per level, never switched: the top level is always "1." numbers, sub-steps are always "-" bullets. Do NOT use lettered ("a.", "b.") or roman-numeral ("i.", "ii.") markers, and do NOT use "*" for bullets.
- Do not continue the top-level numbering into sub-steps. Sub-steps are bullets, so they carry no number at all.
- A step with no sub-actions is just a single numbered line with no nested list beneath it.
- Caveats and rationale go on their own line as "**Note:** ..." (bold label, no list marker), indented one TAB to sit under the step or sub-step they belong to.

Match this shape exactly (there is exactly one tab before each sub-step bullet):

1. Create the organization in WorkOS.
	- Log into WorkOS and open the Organizations tab.
	- Search by name or domain to confirm it does not already exist.
	- Click Create Organization, then enter the name and domain from the request.
2. Invite the admin to the organization.
	- Click Invite Contact and copy the setup link.
	- Paste the link into the Slack thread.
	- **Note:** For SCIM, also check Directory Sync, not just Single Sign On.

Do not add an introduction, summary, or closing remarks unless the transcript contains them.`,
		insertMode: 'newFile',
		newFileFolder: 'Guides',
		newFileNameTemplate: '{{title}}',
		enableContextHint: true,
		titleFromContent: true,
		noteProperties: [
			{ name: 'topic', instruction: 'A short title describing what the guide accomplishes.' },
			{ name: 'tool', instruction: 'The application or tool the guide covers, if named.' },
		],
	},
	{
		id: 'tpl-default-book-log',
		name: 'Book log',
		prompt:
			`Turn the spoken notes into a concise book-log entry. Use these "##" sections, omitting any the transcript does not cover: Summary, Thoughts, Key takeaways, Favorite quotes. Keep Summary to 2-4 sentences describing what the book is about. Capture Thoughts as the speaker's reactions and opinions in lightly cleaned prose. Format Key takeaways as bullets. If the speaker gave a rating, note it at the top as "Rating: ...". Do not invent plot points, opinions, or quotes the speaker did not state.`,
		insertMode: 'newFile',
		newFileFolder: 'Books',
		newFileNameTemplate: '{{title}}',
		enableContextHint: true,
		titleFromContent: true,
		noteProperties: [
			{ name: 'title', instruction: 'The book title.' },
			{ name: 'author', instruction: "The author's full name." },
			{ name: 'series', instruction: 'The series name, or leave blank if standalone.' },
		],
	},
];

export function freshDefaultTemplates(): NoteTemplate[] {
	return DEFAULT_TEMPLATES.map((t) => ({ ...t }));
}
