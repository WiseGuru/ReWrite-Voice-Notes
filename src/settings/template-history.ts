import { NoteTemplate } from '../types';

// A snapshot of a built-in default template as it shipped in a past plugin version.
export interface TemplateVersionSnapshot {
	version: string;          // the plugin version this default shipped in
	template: NoteTemplate;   // the full default as of that version
}

// Prior (superseded) versions of the built-in defaults, keyed by template id.
//
// This is the plugin's "memory" of what each default used to be. It powers two
// things in the Templates settings section:
//   1. Update's per-field 3-way merge: if a user's on-disk value matches one of
//      these snapshots (an unedited older default) it is safely brought forward
//      to the current default instead of being treated as a conflict.
//   2. The "Load prior versions" button, which writes each snapshot into the
//      templates folder as its own selectable template for A/B testing.
//
// It starts EMPTY. MAINTENANCE RULE: whenever you change a default in
// default-templates.ts, append the OUTGOING template here under the manifest
// version it shipped in, e.g.
//
//   'tpl-default-meeting-notes': [
//     { version: '0.1.1', template: { id: 'tpl-default-meeting-notes', name: 'Meeting notes', prompt: `...old prompt...`, ... } },
//   ],
//
// Without the snapshot, Update cannot distinguish an unedited old prompt from a
// user edit and falls back to reporting a body conflict.
export const TEMPLATE_HISTORY: Record<string, TemplateVersionSnapshot[]> = {};

// Prior snapshots for one template id (newest-or-oldest order is irrelevant; the
// merge only checks membership). Returns deep-ish clones so callers can't mutate
// the registry.
export function priorVersionsForId(id: string): NoteTemplate[] {
	const snaps = TEMPLATE_HISTORY[id] ?? [];
	return snaps.map((s) => cloneTemplate(s.template));
}

// Every prior snapshot across all ids, flattened, for the "Load prior versions"
// button. Each carries its id and the snapshot (with version) so the loader can
// build a versioned file name and a distinct id.
export function allPriorVersions(): Array<{ id: string; snapshot: TemplateVersionSnapshot }> {
	const out: Array<{ id: string; snapshot: TemplateVersionSnapshot }> = [];
	for (const [id, snaps] of Object.entries(TEMPLATE_HISTORY)) {
		for (const snapshot of snaps) {
			out.push({ id, snapshot: { version: snapshot.version, template: cloneTemplate(snapshot.template) } });
		}
	}
	return out;
}

function cloneTemplate(t: NoteTemplate): NoteTemplate {
	return {
		...t,
		noteProperties: t.noteProperties ? t.noteProperties.map((p) => ({ ...p })) : undefined,
	};
}
