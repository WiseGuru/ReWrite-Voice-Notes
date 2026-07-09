// Minimal runtime stand-in for the `obsidian` package, aliased in via vitest.config.ts.
// The real `obsidian` npm package ships only type declarations (no runtime JS), so any module
// under test that imports a value (not just a type) from 'obsidian' needs something real to
// resolve to. This file implements just enough of the surface actually exercised by the
// modules covered under test/ — it is not a full Obsidian API shim.
import { parse, stringify } from 'yaml';

export function parseYaml(yamlText: string): unknown {
	if (!yamlText || !yamlText.trim()) return null;
	return parse(yamlText);
}

export function stringifyYaml(obj: unknown): string {
	return stringify(obj);
}

// Approximates Obsidian's normalizePath: forward slashes, no doubled slashes, no leading "./",
// no trailing slash. Not a byte-exact reimplementation, just enough for the path shapes the
// tested modules produce (template/attachment folder paths, the whisper-host PID sidecar path).
export function normalizePath(path: string): string {
	let p = path.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
	p = p.replace(/^\.\//, '');
	if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
	if (p === '.') p = '';
	return p;
}

export function moment(): { format: (fmt?: string) => string } {
	return { format: () => '' };
}

export async function requestUrl(): Promise<never> {
	throw new Error('requestUrl is not implemented in the test environment');
}

export const Platform = {
	isDesktop: true,
	isMobile: false,
	isMacOS: false,
	isWin: false,
};

export class Notice {
	constructor(message?: unknown, duration?: number) {}
	setMessage(): this {
		return this;
	}
	hide(): void {}
}

export class TFile {
	path = '';
	name = '';
	basename = '';
	extension = '';
	stat = { mtime: 0, ctime: 0, size: 0 };
}

export class TFolder {
	path = '';
	children: unknown[] = [];
}

export class TAbstractFile {
	path = '';
}

export class Modal {
	app: unknown;
	contentEl: unknown = {};
	constructor(app: unknown) {
		this.app = app;
	}
	open(): void {}
	close(): void {}
	onOpen(): void {}
	onClose(): void {}
}

export class Setting {
	constructor(containerEl?: unknown) {}
	setName(): this {
		return this;
	}
	setDesc(): this {
		return this;
	}
	setHeading(): this {
		return this;
	}
	addText(): this {
		return this;
	}
	addButton(): this {
		return this;
	}
	addToggle(): this {
		return this;
	}
	addDropdown(): this {
		return this;
	}
}

export class Plugin {
	app: unknown;
	manifest: { id: string; dir?: string } = { id: 'rewrite-voice-notes', dir: '.' };
	constructor(app?: unknown, manifest?: { id: string; dir?: string }) {
		this.app = app;
		if (manifest) this.manifest = manifest;
	}
	async loadData(): Promise<unknown> {
		return null;
	}
	async saveData(): Promise<void> {}
}

export class App {}

export class MarkdownView {}
