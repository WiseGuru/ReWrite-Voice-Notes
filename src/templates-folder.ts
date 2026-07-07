import { App, normalizePath, parseYaml, stringifyYaml, TFile, TFolder } from 'obsidian';
import { GlobalSettings, InsertMode, NotePropertySpec, NoteTemplate } from './types';
import { freshDefaultTemplates } from './settings/default-templates';
import { allPriorVersions, priorVersionsForId } from './settings/template-history';
import { writeTemplateUpdateReport } from './template-guide';

const VALID_INSERT_MODES: ReadonlySet<string> = new Set(['cursor', 'newFile', 'append']);

// Shared by the main modal (its default selection before a user override) and the plugin's
// entry points that need a template id without opening the modal (editor menu, reprocess-audio).
// Was duplicated verbatim in both call sites.
export function pickDefaultTemplateId(settings: GlobalSettings, templates: NoteTemplate[]): string {
	if (settings.lastUsedTemplateId && templates.some((t) => t.id === settings.lastUsedTemplateId)) {
		return settings.lastUsedTemplateId;
	}
	if (settings.defaultTemplateId && templates.some((t) => t.id === settings.defaultTemplateId)) {
		return settings.defaultTemplateId;
	}
	return templates[0]?.id ?? '';
}

export async function loadTemplatesFromFolder(app: App, folderPath: string): Promise<NoteTemplate[]> {
	const normalized = normalizeFolderPath(folderPath);
	if (!normalized) return [];
	const folder = app.vault.getAbstractFileByPath(normalized);
	if (!(folder instanceof TFolder)) return [];

	const items: Array<{ template: NoteTemplate; basename: string }> = [];
	for (const child of folder.children) {
		if (!(child instanceof TFile)) continue;
		if (child.extension !== 'md') continue;
		try {
			const template = await parseTemplateFile(app, child);
			if (template) items.push({ template, basename: child.basename });
		} catch {
			// Skip files with invalid frontmatter so a bad file doesn't hide the rest.
		}
	}
	items.sort((a, b) => a.basename.localeCompare(b.basename));
	return items.map((i) => i.template);
}

export interface PopulateResult {
	created: number;
	skipped: number;
	folder: string;
}

export async function populateDefaultTemplates(app: App, folderPath: string): Promise<PopulateResult> {
	const normalized = normalizeFolderPath(folderPath);
	if (!normalized) throw new Error('Templates folder path is empty.');

	const folder = await ensureFolder(app, normalized);
	const existingIds = await collectExistingIds(app, folder);

	let created = 0;
	let skipped = 0;
	for (const template of freshDefaultTemplates()) {
		if (existingIds.has(template.id)) {
			skipped++;
			continue;
		}
		const filename = `${sanitizeFilename(template.name)}.md`;
		const path = normalizePath(`${normalized}/${filename}`);
		if (app.vault.getAbstractFileByPath(path)) {
			skipped++;
			continue;
		}
		await app.vault.create(path, renderTemplateFile(template));
		created++;
	}
	return { created, skipped, folder: normalized };
}

// One thing the Update button could not safely auto-merge, surfaced in the report.
export interface TemplateUpdateConflict {
	// 'body'              — on-disk prompt differs from the current default prompt.
	// 'removedProperty'   — user has a noteProperty the default no longer ships.
	// 'changedInstruction'— a noteProperty in both with a different instruction.
	// 'parseFailed'       — a default-derived file that could not be parsed.
	kind: 'body' | 'removedProperty' | 'changedInstruction' | 'parseFailed';
	detail?: string;        // property name for property conflicts
	defaultValue?: string;  // "default now" side (body text or instruction)
	userValue?: string;     // "your file" side
	// removedProperty only: true when the user's value matches a prior shipped
	// default (so it is stale default cruft, safe to delete) rather than an
	// addition the user made.
	wasShippedDefault?: boolean;
}

export interface TemplateUpdateEntry {
	id: string;
	name: string;
	path: string;
	status: 'updated' | 'unchanged' | 'created' | 'conflict' | 'parseFailed';
	changes: string[];      // safe edits actually written, e.g. "Added property: subject"
	conflicts: TemplateUpdateConflict[];
}

export interface UpdateResult {
	folder: string;
	created: number;
	updated: number;
	unchanged: number;
	conflicts: number;
	parseFailed: number;
	entries: TemplateUpdateEntry[];
	reportPath: string | null;
}

// Per-field 3-way merge of a user's on-disk default-derived template against the
// current built-in default, using `priors` (the default's earlier shipped
// versions) as the base. For each field, the on-disk value is "pristine" (the
// user never touched it) when it equals the current default OR any prior shipped
// default; a pristine value is safely brought forward to the current default,
// while a genuine user edit is kept. The prompt body is the only field whose
// kept edit becomes a report conflict; scalars/flags are adopted-or-kept
// silently, and a user property the default dropped is always kept (never
// deleted). Pure and synchronous.
export function mergeTemplate(onDisk: NoteTemplate, def: NoteTemplate, priors: NoteTemplate[]): {
	merged: NoteTemplate;
	conflicts: TemplateUpdateConflict[];
	changes: string[];
} {
	const conflicts: TemplateUpdateConflict[] = [];
	const changes: string[] = [];

	// Prompt body: bring an unedited older version forward; surface a real edit.
	const odBody = onDisk.prompt.trim();
	let mergedPrompt: string;
	if (odBody === def.prompt.trim()) {
		mergedPrompt = onDisk.prompt;
	} else if (priors.some((p) => p.prompt.trim() === odBody)) {
		mergedPrompt = def.prompt;
		changes.push('Updated prompt to the current default (your copy matched an earlier shipped version)');
	} else {
		mergedPrompt = onDisk.prompt;
		conflicts.push({ kind: 'body', defaultValue: def.prompt, userValue: onDisk.prompt });
	}

	// Scalars + flags: adopt the new default only when the on-disk value was an
	// unedited prior default; otherwise keep the user's value. Re-rendering also
	// re-emits any newly-introduced stub keys for free.
	const pick = <T>(od: T, dv: T, priorVals: T[], label: string): T => {
		if (od === dv) return dv;
		if (priorVals.some((p) => p === od)) {
			changes.push(`Updated ${label} to the current default`);
			return dv;
		}
		return od;
	};
	const name = pick(onDisk.name, def.name, priors.map((p) => p.name), 'name');
	const insertMode = pick(onDisk.insertMode, def.insertMode, priors.map((p) => p.insertMode), 'insert mode');
	const newFileFolder = pick(onDisk.newFileFolder, def.newFileFolder, priors.map((p) => p.newFileFolder), 'new-file folder');
	const newFileNameTemplate = pick(onDisk.newFileNameTemplate, def.newFileNameTemplate, priors.map((p) => p.newFileNameTemplate), 'new-file name');
	const disableSharedCore = pick(!!onDisk.disableSharedCore, !!def.disableSharedCore, priors.map((p) => !!p.disableSharedCore), 'shared-core opt-out');
	const enableContextHint = pick(!!onDisk.enableContextHint, !!def.enableContextHint, priors.map((p) => !!p.enableContextHint), 'context hint flag');
	const diarize = pick(!!onDisk.diarize, !!def.diarize, priors.map((p) => !!p.diarize), 'diarize flag');
	const titleFromContent = pick(!!onDisk.titleFromContent, !!def.titleFromContent, priors.map((p) => !!p.titleFromContent), 'title-from-content flag');

	// noteProperties: union by name, preserving the user's order.
	const userProps = onDisk.noteProperties ?? [];
	const defProps = def.noteProperties ?? [];
	const defByName = new Map(defProps.map((p) => [p.name, p]));
	const userByName = new Map(userProps.map((p) => [p.name, p]));
	const mergedProps: NotePropertySpec[] = [];

	for (const userProp of userProps) {
		const defProp = defByName.get(userProp.name);
		const ui = userProp.instruction.trim();
		if (!defProp) {
			// Default dropped it. Keep it (never delete user data); flag, noting
			// when it was the default's own property so the user knows it is safe
			// to remove.
			const wasShippedDefault = priors.some((p) => (p.noteProperties ?? [])
				.some((pp) => pp.name === userProp.name && pp.instruction.trim() === ui));
			conflicts.push({ kind: 'removedProperty', detail: userProp.name, userValue: userProp.instruction, wasShippedDefault });
			mergedProps.push(userProp);
		} else if (defProp.instruction.trim() === ui) {
			mergedProps.push(userProp); // unchanged
		} else if (priors.some((p) => (p.noteProperties ?? [])
			.some((pp) => pp.name === userProp.name && pp.instruction.trim() === ui))) {
			// Unedited prior default instruction -> bring forward.
			mergedProps.push({ name: userProp.name, instruction: defProp.instruction });
			changes.push(`Updated property instruction: ${userProp.name}`);
		} else {
			mergedProps.push(userProp); // user edit -> keep, flag
			conflicts.push({ kind: 'changedInstruction', detail: userProp.name, defaultValue: defProp.instruction, userValue: userProp.instruction });
		}
	}
	for (const defProp of defProps) {
		if (!userByName.has(defProp.name)) {
			mergedProps.push({ ...defProp });
			changes.push(`Added property: ${defProp.name}`);
		}
	}

	const merged: NoteTemplate = {
		id: onDisk.id,
		name,
		prompt: mergedPrompt,
		insertMode,
		newFileFolder,
		newFileNameTemplate,
		disableSharedCore,
		enableContextHint,
		diarize,
		titleFromContent,
		noteProperties: mergedProps,
	};
	return { merged, conflicts, changes };
}

// Reconcile the user's default-derived template files (matched by frontmatter id)
// with the current built-in defaults: fill in new fields and missing properties,
// recreate any defaults deleted entirely, and never overwrite user edits. Anything
// that cannot be safely auto-merged is written to a human-facing report file.
export async function updateDefaultTemplates(app: App, folderPath: string): Promise<UpdateResult> {
	const normalized = normalizeFolderPath(folderPath);
	if (!normalized) throw new Error('Templates folder path is empty.');

	const folder = await ensureFolder(app, normalized);
	const defaultsById = new Map(freshDefaultTemplates().map((t) => [t.id, t]));

	const entries: TemplateUpdateEntry[] = [];
	const seenIds = new Set<string>();
	let created = 0;
	let updated = 0;
	let unchanged = 0;
	let conflicts = 0;
	let parseFailed = 0;

	for (const child of folder.children) {
		if (!(child instanceof TFile)) continue;
		if (child.extension !== 'md') continue;
		// Single read per file, reused for the id check, the full parse, and the diff below
		// (previously up to three separate reads of the same file).
		const original = await app.vault.read(child);
		const id = readTemplateIdFromContent(original);
		if (!id) continue;
		const def = defaultsById.get(id);
		if (!def) continue; // user's own template (id not in the default set)
		seenIds.add(id);

		let onDisk: NoteTemplate | null = null;
		try {
			onDisk = parseTemplateContent(child, original);
		} catch {
			onDisk = null;
		}
		if (!onDisk) {
			parseFailed++;
			entries.push({
				id, name: def.name, path: child.path, status: 'parseFailed',
				changes: [], conflicts: [{ kind: 'parseFailed' }],
			});
			continue;
		}

		const { merged, conflicts: cf, changes } = mergeTemplate(onDisk, def, priorVersionsForId(id));
		const rendered = renderTemplateFile(merged);
		// Normalize CRLF so we don't rewrite a file purely over line endings.
		const changedOnDisk = rendered !== original.replace(/\r\n/g, '\n');

		if (!changedOnDisk && cf.length === 0) {
			unchanged++;
			entries.push({ id, name: onDisk.name, path: child.path, status: 'unchanged', changes, conflicts: cf });
			continue;
		}
		if (changedOnDisk) await app.vault.process(child, () => rendered);
		if (cf.length > 0) {
			conflicts++;
			entries.push({ id, name: onDisk.name, path: child.path, status: 'conflict', changes, conflicts: cf });
		} else {
			updated++;
			entries.push({ id, name: onDisk.name, path: child.path, status: 'updated', changes, conflicts: cf });
		}
	}

	// Restore defaults missing from disk entirely (superset top-up), reusing the
	// same name + path-collision skip as Populate.
	for (const def of defaultsById.values()) {
		if (seenIds.has(def.id)) continue;
		const filename = `${sanitizeFilename(def.name)}.md`;
		const path = normalizePath(`${normalized}/${filename}`);
		if (app.vault.getAbstractFileByPath(path)) continue;
		await app.vault.create(path, renderTemplateFile(def));
		created++;
		entries.push({ id: def.id, name: def.name, path, status: 'created', changes: [], conflicts: [] });
	}

	const result: UpdateResult = {
		folder: normalized, created, updated, unchanged, conflicts, parseFailed, entries, reportPath: null,
	};
	if (entries.some((e) => e.status !== 'unchanged')) {
		result.reportPath = await writeTemplateUpdateReport(app, normalized, result);
	}
	return result;
}

export interface LoadPriorResult {
	folder: string;
	created: number;
	skipped: number;   // already on disk (by id or path)
	available: number; // total prior snapshots known to the plugin
}

// Write each prior shipped version of the built-in defaults into the templates
// folder as its own selectable template, so the user can pick it in the modal and
// A/B test it against the current one. Each gets a distinct id (`<id>@<version>`)
// and a versioned name (`<name> <version>`) so it never collides with the live
// template's identity, and is left untouched by Update (its id is not a current
// default) and Populate. Non-destructive: skips any snapshot already on disk.
export async function loadPriorTemplateVersions(app: App, folderPath: string): Promise<LoadPriorResult> {
	const normalized = normalizeFolderPath(folderPath);
	if (!normalized) throw new Error('Templates folder path is empty.');

	const folder = await ensureFolder(app, normalized);
	const existingIds = await collectExistingIds(app, folder);

	const all = allPriorVersions();
	let created = 0;
	let skipped = 0;
	for (const { id, snapshot } of all) {
		const newId = `${id}@${snapshot.version}`;
		if (existingIds.has(newId)) {
			skipped++;
			continue;
		}
		const newName = `${snapshot.template.name} ${snapshot.version}`;
		const filename = `${sanitizeFilename(newName)}.md`;
		const path = normalizePath(`${normalized}/${filename}`);
		if (app.vault.getAbstractFileByPath(path)) {
			skipped++;
			continue;
		}
		await app.vault.create(path, renderTemplateFile({ ...snapshot.template, id: newId, name: newName }));
		created++;
	}
	return { folder: normalized, created, skipped, available: all.length };
}

export function isPathInTemplatesFolder(path: string, folderPath: string): boolean {
	const normalizedFolder = normalizeFolderPath(folderPath);
	if (!normalizedFolder) return false;
	const normalizedPath = normalizePath(path);
	return normalizedPath === normalizedFolder
		|| normalizedPath.startsWith(`${normalizedFolder}/`);
}

async function parseTemplateFile(app: App, file: TFile): Promise<NoteTemplate | null> {
	const content = await app.vault.read(file);
	return parseTemplateContent(file, content);
}

// Split out from parseTemplateFile so callers that already hold the file content (the update
// walk previously read each candidate file up to three times: once for the id, once for the
// full parse, once more to diff against the rendered output) can parse without a redundant read.
export function parseTemplateContent(file: TFile, content: string): NoteTemplate | null {
	const { frontmatter, body } = splitFrontmatter(content);
	if (!frontmatter) return null;
	const parsed: unknown = parseYaml(frontmatter);
	if (!parsed || typeof parsed !== 'object') return null;
	const obj = parsed as Record<string, unknown>;

	const id = typeof obj.id === 'string' ? obj.id.trim() : '';
	if (!id) return null;

	const nameRaw = typeof obj.name === 'string' ? obj.name.trim() : '';
	const name = nameRaw || file.basename;

	const insertMode: InsertMode = typeof obj.insertMode === 'string' && VALID_INSERT_MODES.has(obj.insertMode)
		? (obj.insertMode as InsertMode)
		: 'cursor';

	const newFileFolder = typeof obj.newFileFolder === 'string' ? obj.newFileFolder : '';
	const newFileNameTemplateRaw = typeof obj.newFileNameTemplate === 'string' ? obj.newFileNameTemplate : '';
	const newFileNameTemplate = newFileNameTemplateRaw || 'ReWrite {{date}} {{time}}';

	// Tolerate both a YAML boolean (`true`) and a string ("true"), since editing
	// the property via Obsidian's Properties UI may store it as text. An empty
	// value (null) or anything else means "not disabled".
	const rawDisable = obj.disableSharedCore;
	const disableSharedCore = rawDisable === true
		|| (typeof rawDisable === 'string' && rawDisable.trim().toLowerCase() === 'true');

	// Same tolerance as disableSharedCore (boolean true or string "true"); this
	// flag is a positive opt-in, so anything else / absent means not enabled.
	const rawContext = obj.enableContextHint;
	const enableContextHint = rawContext === true
		|| (typeof rawContext === 'string' && rawContext.trim().toLowerCase() === 'true');

	// Forces diarization on for this template (capable providers only); same
	// boolean/string tolerance as the other flags.
	const rawDiarize = obj.diarize;
	const diarize = rawDiarize === true
		|| (typeof rawDiarize === 'string' && rawDiarize.trim().toLowerCase() === 'true');

	// Same boolean/string tolerance as the other opt-in flags; turns on LLM-generated
	// filenames for this template (see Note title in the docs).
	const rawTitleFromContent = obj.titleFromContent;
	const titleFromContent = rawTitleFromContent === true
		|| (typeof rawTitleFromContent === 'string' && rawTitleFromContent.trim().toLowerCase() === 'true');

	// Authored as a YAML map (key = property name, value = instruction). Parsed
	// into an ordered array (object key order is preserved). Non-map values and
	// blank keys are skipped; a missing/non-string instruction becomes "".
	const noteProperties: NotePropertySpec[] = [];
	const rawProps = obj.noteProperties;
	if (rawProps && typeof rawProps === 'object' && !Array.isArray(rawProps)) {
		for (const [name, instruction] of Object.entries(rawProps as Record<string, unknown>)) {
			const key = name.trim();
			if (!key) continue;
			noteProperties.push({
				name: key,
				instruction: typeof instruction === 'string' ? instruction.trim() : '',
			});
		}
	}

	return {
		id,
		name,
		prompt: body.trim(),
		insertMode,
		newFileFolder,
		newFileNameTemplate,
		disableSharedCore,
		enableContextHint,
		diarize,
		titleFromContent,
		noteProperties,
	};
}

async function collectExistingIds(app: App, folder: TFolder): Promise<Set<string>> {
	const ids = new Set<string>();
	for (const child of folder.children) {
		if (!(child instanceof TFile)) continue;
		if (child.extension !== 'md') continue;
		const id = await readTemplateId(app, child);
		if (id) ids.add(id);
	}
	return ids;
}

// Cheap id-only read so the update walk can decide whether a file is
// default-derived before paying for a full parseTemplateFile.
async function readTemplateId(app: App, file: TFile): Promise<string | null> {
	try {
		const content = await app.vault.read(file);
		return readTemplateIdFromContent(content);
	} catch {
		return null;
	}
}

function readTemplateIdFromContent(content: string): string | null {
	try {
		const { frontmatter } = splitFrontmatter(content);
		if (!frontmatter) return null;
		const parsed: unknown = parseYaml(frontmatter);
		if (!parsed || typeof parsed !== 'object') return null;
		const id = (parsed as Record<string, unknown>).id;
		return typeof id === 'string' && id.trim() ? id.trim() : null;
	} catch {
		return null;
	}
}

async function ensureFolder(app: App, path: string): Promise<TFolder> {
	const existing = app.vault.getAbstractFileByPath(path);
	if (existing instanceof TFolder) return existing;
	if (existing) throw new Error(`${path} exists but is not a folder.`);
	const created = await app.vault.createFolder(path);
	if (created instanceof TFolder) return created;
	const resolved = app.vault.getAbstractFileByPath(path);
	if (resolved instanceof TFolder) return resolved;
	throw new Error(`Failed to create folder ${path}.`);
}

function splitFrontmatter(content: string): { frontmatter: string | null; body: string } {
	if (!content.startsWith('---')) return { frontmatter: null, body: content };
	const lines = content.split(/\r?\n/);
	if (lines[0]?.trim() !== '---') return { frontmatter: null, body: content };
	for (let i = 1; i < lines.length; i++) {
		if (lines[i]?.trim() === '---') {
			return {
				frontmatter: lines.slice(1, i).join('\n'),
				body: lines.slice(i + 1).join('\n'),
			};
		}
	}
	return { frontmatter: null, body: content };
}

export function renderTemplateFile(template: NoteTemplate): string {
	const fm = stringifyYaml({
		id: template.id,
		name: template.name,
		insertMode: template.insertMode,
		newFileFolder: template.newFileFolder,
		newFileNameTemplate: template.newFileNameTemplate,
	}).replace(/\n+$/, '');
	// Always surface the disableSharedCore knob: present so it is easy to find,
	// empty (null) so it does not apply until the user sets it to `true`.
	const disableLine = template.disableSharedCore
		? 'disableSharedCore: true'
		: 'disableSharedCore:';
	// Same discoverability treatment for the opt-in context-hint knob.
	const contextLine = template.enableContextHint
		? 'enableContextHint: true'
		: 'enableContextHint:';
	// And for the opt-in diarization knob.
	const diarizeLine = template.diarize
		? 'diarize: true'
		: 'diarize:';
	// And for the opt-in content-titling knob.
	const titleLine = template.titleFromContent
		? 'titleFromContent: true'
		: 'titleFromContent:';
	// noteProperties is a nested map, so unlike the booleans it is emitted only
	// when the template actually declares properties (no always-empty stub).
	const propsBlock = template.noteProperties && template.noteProperties.length > 0
		? '\n' + stringifyYaml({
			noteProperties: Object.fromEntries(
				template.noteProperties.map((p) => [p.name, p.instruction]),
			),
		}).replace(/\n+$/, '')
		: '';
	return `---\n${fm}\n${disableLine}\n${contextLine}\n${diarizeLine}\n${titleLine}${propsBlock}\n---\n${template.prompt}\n`;
}

// Guards against names that are unsafe/unusable as a file basename: purely dots (would
// produce a hidden Unix file or an OS-trimmed Windows one), or one of the reserved Windows
// device names (case-insensitive; Windows treats these as special regardless of extension,
// e.g. "CON.md" is still the reserved device). Intended as the LAST step of a sanitization
// pipeline: an intermediate transform (dot-stripping, length capping) can turn a name that
// wasn't reserved into one that is, so callers with extra hardening beyond sanitizeFilename
// (see insert.ts's titleToFilename) should call this again on their own final result.
export function guardReservedName(name: string): string {
	if (/^\.*$/.test(name)) return 'Untitled';
	if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name)) return `_${name}`;
	return name;
}

export function sanitizeFilename(name: string): string {
	const cleaned = name.replace(/[\\/:*?"<>|]/g, '-').trim();
	return guardReservedName(cleaned || 'Untitled');
}

function normalizeFolderPath(folderPath: string): string {
	const trimmed = folderPath.trim();
	if (!trimmed) return '';
	const normalized = normalizePath(trimmed);
	if (!normalized || normalized === '/' || normalized === '.') return '';
	return normalized;
}
