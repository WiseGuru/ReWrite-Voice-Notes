// Build the plugin and copy the three release artifacts into a scratch Obsidian vault's
// plugin folder, so the release-checklist's manual feature pass can start from a clean
// install without hand-copying files. Plain ESM at repo root, same convention as
// version-bump.mjs / local-review.mjs; pure helpers are exported for
// test/prepare-release-vault.test.ts and the side-effecting entry point is guarded behind
// the import.meta.url === process.argv[1] check.
//
// Unlike local-review.mjs, this FAILS LOUDLY (non-zero exit) on any error. There is no
// "advisory" framing for release prep: if the build fails or the vault path is wrong, the
// human needs to stop and fix it.

import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// The three loose asset files an Obsidian plugin ships (never zipped). Fixed list.
export const RELEASE_FILES = ['main.js', 'manifest.json', 'styles.css'];

export function parseReleaseVaultConfig(raw) {
	if (!raw || typeof raw !== 'object') {
		throw new Error('dev-tools.config.json is missing or is not a JSON object.');
	}
	const rv = raw.releaseVault;
	if (!rv || typeof rv !== 'object') {
		throw new Error('dev-tools.config.json has no "releaseVault" section. See dev-tools.config.example.json.');
	}
	const vaultPath = typeof rv.vaultPath === 'string' ? rv.vaultPath.trim() : '';
	if (!vaultPath) throw new Error('releaseVault.vaultPath is required (path to a scratch Obsidian vault for release testing; never a real personal vault).');
	return { vaultPath };
}

// The plugin id is derived from manifest.json, never duplicated. It is also the folder
// name Obsidian requires the plugin to live under.
export function readPluginId(manifest) {
	if (!manifest || typeof manifest.id !== 'string' || !manifest.id.trim()) {
		throw new Error('manifest.json has no "id".');
	}
	return manifest.id.trim();
}

export function computeTargetPluginDir(vaultPath, pluginId) {
	return join(vaultPath, '.obsidian', 'plugins', pluginId);
}

// --- Runtime (not exported; not unit-tested) --------------------------------------------

function main() {
	const repoRoot = dirname(fileURLToPath(import.meta.url));

	const configPath = join(repoRoot, 'dev-tools.config.json');
	if (!existsSync(configPath)) {
		throw new Error(`No dev-tools.config.json found at ${configPath}. Copy dev-tools.config.example.json to dev-tools.config.json and fill in releaseVault.vaultPath.`);
	}
	const config = parseReleaseVaultConfig(JSON.parse(readFileSync(configPath, 'utf8')));

	// Validate the vault path up front, before building or creating any directory, so a
	// bad path fails fast with no stray directory creation.
	if (!existsSync(config.vaultPath)) {
		throw new Error(`releaseVault.vaultPath does not exist: ${config.vaultPath}`);
	}
	if (!existsSync(join(config.vaultPath, '.obsidian'))) {
		console.warn(`Warning: ${config.vaultPath} has no .obsidian subfolder. If this vault has never been opened in Obsidian, open it once first so the plugins folder is recognized.`);
	}

	const pluginId = readPluginId(JSON.parse(readFileSync(join(repoRoot, 'manifest.json'), 'utf8')));

	console.log('Running npm run build...');
	const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
	execFileSync(npm, ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' });

	const targetDir = computeTargetPluginDir(config.vaultPath, pluginId);
	mkdirSync(targetDir, { recursive: true });

	for (const file of RELEASE_FILES) {
		const src = join(repoRoot, file);
		if (!existsSync(src)) {
			throw new Error(`Expected build artifact not found: ${src}. Did npm run build succeed?`);
		}
		copyFileSync(src, join(targetDir, file));
		console.log(`Copied ${file} -> ${join(targetDir, file)}`);
	}

	console.log(`\nDone. Now in Obsidian: open the vault at ${config.vaultPath}, then reload the plugin`);
	console.log(`(Settings -> Community plugins -> toggle "${pluginId}" off and on, or reload Obsidian) to pick up the new build.`);
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
	try {
		main();
	} catch (e) {
		console.error(`\nERROR: ${e?.message ?? String(e)}\n`);
		process.exit(1);
	}
}
