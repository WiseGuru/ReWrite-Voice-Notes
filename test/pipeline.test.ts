import { describe, expect, it } from 'vitest';
import { extractFromBlock } from '../src/pipeline';
import { NotePropertySpec } from '../src/types';

const PROPS: NotePropertySpec[] = [
	{ name: 'subject', instruction: 'the meeting subject' },
	{ name: 'participants', instruction: 'who attended' },
];

describe('extractFromBlock', () => {
	it('parses a tagged ```yaml block and strips it from the body', () => {
		const raw = '```yaml\nsubject: Roadmap sync\nparticipants: Alice, Bob\n```\n\nThe body starts here.';
		const result = extractFromBlock(raw, PROPS, false);
		expect(result.properties).toEqual({ subject: 'Roadmap sync', participants: 'Alice, Bob' });
		expect(result.body).toBe('The body starts here.');
		expect(result.title).toBeUndefined();
	});

	// Regression test for the fix in pipeline.ts: the fence regex used to make the yaml/yml tag
	// optional, so a model that wrapped its ENTIRE reply in a bare ``` fence had the whole note
	// swallowed as "the properties block" and left with an empty body.
	it('does not treat a bare ``` fence (no yaml tag) as the properties block', () => {
		const raw = '```\nJust some fenced content, not a properties block.\n```';
		const result = extractFromBlock(raw, PROPS, false);
		expect(result.body).toBe(raw);
		expect(result.properties).toEqual({ subject: '', participants: '' });
	});

	it('accepts a ```yml tag as well as ```yaml', () => {
		const raw = '```yml\nsubject: Standup\nparticipants: Team\n```\n\nBody.';
		const result = extractFromBlock(raw, PROPS, false);
		expect(result.properties.subject).toBe('Standup');
		expect(result.body).toBe('Body.');
	});

	it('returns the whole trimmed output as body when no block is present', () => {
		const raw = '  Just plain cleaned-up text, no properties requested.  ';
		const result = extractFromBlock(raw, PROPS, false);
		expect(result.body).toBe('Just plain cleaned-up text, no properties requested.');
		expect(result.properties).toEqual({ subject: '', participants: '' });
	});

	it('falls back to the tolerant line parser on malformed YAML, still stripping the block', () => {
		// An unterminated quote is invalid YAML and makes js-yaml's strict parser throw.
		const raw = '```yaml\nsubject: "Unterminated quote\nparticipants: Alice\n```\n\nBody text.';
		const result = extractFromBlock(raw, PROPS, false);
		expect(result.properties.participants).toBe('Alice');
		expect(result.body).toBe('Body text.');
	});

	it('extracts the reserved noteTitle key into title, not into properties', () => {
		const raw = '```yaml\nsubject: Kickoff\nparticipants: Everyone\nnoteTitle: Kickoff meeting notes\n```\n\nBody.';
		const result = extractFromBlock(raw, PROPS, true);
		expect(result.title).toBe('Kickoff meeting notes');
		expect(result.properties).toEqual({ subject: 'Kickoff', participants: 'Everyone' });
		expect(Object.keys(result.properties)).not.toContain('noteTitle');
	});

	it('ignores noteTitle when wantsTitle is false', () => {
		const raw = '```yaml\nsubject: Kickoff\nparticipants: Everyone\nnoteTitle: Should be ignored\n```\n\nBody.';
		const result = extractFromBlock(raw, PROPS, false);
		expect(result.title).toBeUndefined();
	});

	it('leaves declared properties blank when the model omits them', () => {
		const raw = '```yaml\nsubject: Only subject given\n```\n\nBody.';
		const result = extractFromBlock(raw, PROPS, false);
		expect(result.properties).toEqual({ subject: 'Only subject given', participants: '' });
	});
});
