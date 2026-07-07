import { describe, expect, it } from 'vitest';
import { mergeTemplate, parseTemplateContent, renderTemplateFile } from '../src/templates-folder';
import { NoteTemplate } from '../src/types';
import { TFile } from '../test/mocks/obsidian';

function baseTemplate(overrides: Partial<NoteTemplate> = {}): NoteTemplate {
	return {
		id: 'general-cleanup',
		name: 'General cleanup',
		prompt: 'Clean up the transcript.',
		insertMode: 'cursor',
		newFileFolder: '',
		newFileNameTemplate: 'ReWrite {{date}} {{time}}',
		...overrides,
	};
}

function fakeFile(basename: string): TFile {
	const file = new TFile();
	file.basename = basename;
	return file;
}

describe('renderTemplateFile / parseTemplateContent round trip', () => {
	it('round-trips a template with no optional fields', () => {
		const template = baseTemplate();
		const rendered = renderTemplateFile(template);
		const parsed = parseTemplateContent(fakeFile('General cleanup'), rendered);
		expect(parsed).not.toBeNull();
		expect(parsed).toMatchObject({
			id: template.id,
			name: template.name,
			prompt: template.prompt,
			insertMode: template.insertMode,
			newFileFolder: template.newFileFolder,
			newFileNameTemplate: template.newFileNameTemplate,
			disableSharedCore: false,
			enableContextHint: false,
			diarize: false,
			titleFromContent: false,
		});
	});

	it('round-trips the four boolean flags and noteProperties', () => {
		const template = baseTemplate({
			disableSharedCore: true,
			enableContextHint: true,
			diarize: true,
			titleFromContent: true,
			noteProperties: [
				{ name: 'subject', instruction: 'the meeting subject' },
				{ name: 'participants', instruction: 'who attended' },
			],
		});
		const rendered = renderTemplateFile(template);
		const parsed = parseTemplateContent(fakeFile('x'), rendered);
		expect(parsed?.disableSharedCore).toBe(true);
		expect(parsed?.enableContextHint).toBe(true);
		expect(parsed?.diarize).toBe(true);
		expect(parsed?.titleFromContent).toBe(true);
		expect(parsed?.noteProperties).toEqual(template.noteProperties);
	});

	it('falls back to the file basename when frontmatter name is blank', () => {
		const rendered = renderTemplateFile(baseTemplate({ name: '' }));
		const parsed = parseTemplateContent(fakeFile('Fallback Name'), rendered);
		expect(parsed?.name).toBe('Fallback Name');
	});

	it('returns null when the frontmatter has no id', () => {
		const content = '---\nname: No id\n---\nBody.';
		expect(parseTemplateContent(fakeFile('x'), content)).toBeNull();
	});
});

describe('mergeTemplate', () => {
	it('keeps an on-disk prompt matching the current default unchanged, no conflict', () => {
		const def = baseTemplate({ prompt: 'Current default prompt.' });
		const onDisk = baseTemplate({ prompt: 'Current default prompt.' });
		const { merged, conflicts, changes } = mergeTemplate(onDisk, def, []);
		expect(merged.prompt).toBe('Current default prompt.');
		expect(conflicts).toHaveLength(0);
		expect(changes).toHaveLength(0);
	});

	it('silently adopts the current default when the on-disk prompt matches a prior shipped version', () => {
		const priorPrompt = 'Old shipped prompt.';
		const def = baseTemplate({ prompt: 'New default prompt.' });
		const onDisk = baseTemplate({ prompt: priorPrompt });
		const priors = [baseTemplate({ prompt: priorPrompt })];
		const { merged, conflicts, changes } = mergeTemplate(onDisk, def, priors);
		expect(merged.prompt).toBe('New default prompt.');
		expect(conflicts).toHaveLength(0);
		expect(changes.length).toBeGreaterThan(0);
	});

	it('keeps a genuinely edited prompt and reports it as a body conflict', () => {
		const def = baseTemplate({ prompt: 'New default prompt.' });
		const onDisk = baseTemplate({ prompt: 'My own custom prompt that matches no known version.' });
		const { merged, conflicts } = mergeTemplate(onDisk, def, []);
		expect(merged.prompt).toBe(onDisk.prompt);
		expect(conflicts).toEqual([{ kind: 'body', defaultValue: def.prompt, userValue: onDisk.prompt }]);
	});

	it('never deletes a user property the default has dropped', () => {
		const def = baseTemplate({ noteProperties: [] });
		const onDisk = baseTemplate({ noteProperties: [{ name: 'custom', instruction: 'user added this' }] });
		const { merged, conflicts } = mergeTemplate(onDisk, def, []);
		expect(merged.noteProperties).toEqual([{ name: 'custom', instruction: 'user added this' }]);
		expect(conflicts.some((c) => c.kind === 'removedProperty')).toBe(true);
	});

	it('adds a newly-introduced default property the user file lacks', () => {
		const def = baseTemplate({ noteProperties: [{ name: 'subject', instruction: 'fill this in' }] });
		const onDisk = baseTemplate({ noteProperties: [] });
		const { merged, changes } = mergeTemplate(onDisk, def, []);
		expect(merged.noteProperties).toEqual([{ name: 'subject', instruction: 'fill this in' }]);
		expect(changes.some((c) => c.includes('subject'))).toBe(true);
	});
});
