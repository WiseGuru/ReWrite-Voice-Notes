// Advisory local code-review pass over the current diff, run against a locally-hosted
// llama.cpp model (Ornith 1.0) before loading a build into Obsidian to test by hand.
// Plain ESM, no TypeScript, no runtime dependency (Node's global fetch covers the HTTP
// call), same convention as version-bump.mjs / esbuild.config.mjs. Pure logic is exported
// for test/local-review.test.ts; the side-effecting entry point is guarded behind the
// import.meta.url === process.argv[1] check at the bottom, exactly like version-bump.mjs.
//
// Advisory-only by design: this ALWAYS exits 0. A setup failure (missing config, git
// error, server never became ready) prints a clearly marked ERROR: block, never a stack
// trace and never a non-zero exit, so it can never block the local build-and-test loop.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const READY_POLL_MS = 250;
const STOP_KILL_GRACE_MS = 3_000;
const MAX_LOG_BYTES = 1_000_000;

// --- Loopback guard (duplicated from src/whisper-host.ts on purpose) -------------------
// src/whisper-host.ts can't be imported from plain Node: its top-level `import ... from
// 'obsidian'` only resolves inside the Obsidian bundle (or behind the Vitest alias). These
// ~20 lines get their own copy here, and their own coverage in test/local-review.test.ts,
// because llama-server (like whisper-server) has no auth or TLS and must never bind off
// loopback.

// Naive whitespace tokenizer for the extraArgs string (matches whisper-host's splitArgs;
// a single argument containing spaces is not supported, which is fine for an argv array).
export function splitArgs(s) {
	const trimmed = String(s ?? '').trim();
	if (!trimmed) return [];
	return trimmed.split(/\s+/);
}

// Find the values of ALL --host arguments in an already-tokenized arg list. Every
// occurrence must be collected, not just the first: llama-server honors the LAST --host, so
// checking only the first would let `--host 127.0.0.1 --host 0.0.0.0` slip past the guard.
export function getHostArgs(args) {
	const hosts = [];
	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		if (a === '--host') {
			hosts.push(args[i + 1] ?? '');
		} else if (a !== undefined && a.startsWith('--host=')) {
			hosts.push(a.slice('--host='.length));
		}
	}
	return hosts;
}

// Whether a host value binds only the loopback interface.
export function isLoopbackHost(host) {
	const h = String(host ?? '').trim().toLowerCase();
	return h === '127.0.0.1' || h === 'localhost' || h === '::1' || h === '[::1]';
}

// --- Config -----------------------------------------------------------------------------
// dev-tools.config.json (gitignored, no baked defaults) mirrors LocalWhisperSettings'
// philosophy: required paths validated present + existsSync before use. `exists` is
// injectable so tests don't need real files on disk.
export function parseLocalReviewConfig(raw, exists = existsSync) {
	if (!raw || typeof raw !== 'object') {
		throw new Error('dev-tools.config.json is missing or is not a JSON object.');
	}
	const lr = raw.localReview;
	if (!lr || typeof lr !== 'object') {
		throw new Error('dev-tools.config.json has no "localReview" section. See dev-tools.config.example.json.');
	}
	const binaryPath = typeof lr.binaryPath === 'string' ? lr.binaryPath.trim() : '';
	const modelPath = typeof lr.modelPath === 'string' ? lr.modelPath.trim() : '';
	if (!binaryPath) throw new Error('localReview.binaryPath is required (path to the llama-server executable).');
	if (!modelPath) throw new Error('localReview.modelPath is required (path to the Ornith 1.0 gguf).');
	if (!exists(binaryPath)) throw new Error(`localReview.binaryPath does not exist: ${binaryPath}`);
	if (!exists(modelPath)) throw new Error(`localReview.modelPath does not exist: ${modelPath}`);
	return {
		binaryPath,
		modelPath,
		port: Number.isFinite(lr.port) && lr.port > 0 && lr.port <= 65535 ? lr.port : 8090,
		extraArgs: typeof lr.extraArgs === 'string' ? lr.extraArgs : '',
		baseRef: typeof lr.baseRef === 'string' && lr.baseRef.trim() ? lr.baseRef.trim() : 'master',
		readyTimeoutMs: Number.isFinite(lr.readyTimeoutMs) && lr.readyTimeoutMs > 0 ? lr.readyTimeoutMs : 60_000,
		requestTimeoutMs: Number.isFinite(lr.requestTimeoutMs) && lr.requestTimeoutMs > 0 ? lr.requestTimeoutMs : 300_000,
		maxDiffChars: Number.isFinite(lr.maxDiffChars) && lr.maxDiffChars > 0 ? lr.maxDiffChars : 60_000,
	};
}

// --- CLI + diff scope -------------------------------------------------------------------
export function parseCliArgs(argv) {
	const out = { base: null, staged: false, full: false };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--base') {
			out.base = argv[i + 1] ?? null;
			i++;
		} else if (a.startsWith('--base=')) {
			out.base = a.slice('--base='.length);
		} else if (a === '--staged') {
			out.staged = true;
		} else if (a === '--full') {
			out.full = true;
		}
	}
	return out;
}

// Build the `git diff` argument list for a scope. Default scope diffs the merge-base
// against the working tree ("everything you're about to go test": staged + unstaged +
// committed-since-branch). --staged narrows to the index; --full to the last commit only.
export function buildDiffArgs(scope, mergeBase, { stat = false } = {}) {
	const base = ['diff'];
	if (stat) base.push('--stat');
	if (scope.staged) return [...base, '--staged'];
	if (scope.full) return [...base, 'HEAD~1', 'HEAD'];
	return [...base, mergeBase];
}

export function scopeLabel(scope) {
	if (scope.staged) return 'staged changes (index vs HEAD)';
	if (scope.full) return 'last commit only (HEAD~1..HEAD)';
	return 'working tree vs merge-base (staged + unstaged + committed since branch)';
}

// --- Prompt -----------------------------------------------------------------------------
export const REVIEW_SYSTEM_PROMPT = [
	'You are a focused code reviewer for the ReWrite (Voice Notes) plugin for Obsidian, a TypeScript codebase.',
	'You are given a git diff. Review ONLY the changed code. Report, most important first:',
	'',
	'1. Correctness bugs: logic errors, unhandled edge cases, off-by-one, wrong conditionals, broken control flow, missing awaits, resource leaks.',
	'2. Simplification and reuse: duplicated logic, needless complexity, an existing helper that should have been reused.',
	'3. Efficiency: obvious wasted work (redundant reloads, quadratic loops, re-parsing).',
	'',
	'Pay SPECIAL attention to this repo-specific class of bug, which has shipped past the build/lint/test suite before because there is no headless UI test harness:',
	'- DOM event wiring, enable/disable state, and button/control lifecycle. Flag any handler that is registered but can never fire, a control disabled by an over-broad guard so the user is locked out (e.g. a Record/Stop button that a shared isLocked() guard disables during the very state it is meant to control), a listener added without a matching removal, or state that is read stale after a re-render.',
	'- Regex or string parsing that only handles the happy path (e.g. a fence/marker regex that swallows unrelated content, a guard that checks only the first of several occurrences).',
	'',
	'Also flag, briefly, any violation of these house rules the Obsidian review bot enforces:',
	'- No `!important` in CSS; no `eslint-disable` directives.',
	'- Popout-window safety: prefer `activeDocument` / `activeWindow` and `window.setTimeout` over bare globals; do not use `globalThis`.',
	'',
	'Be concrete: name the file and the symptom, and give the failing input or state where you can. If you are unsure, say so rather than inventing a bug. If the diff looks clean, say that plainly. You are a first-pass filter running locally on a quantized model with no ability to explore the rest of the repo, so do not fabricate confidence.',
].join('\n');

export function buildReviewMessages(diffText) {
	return [
		{ role: 'system', content: REVIEW_SYSTEM_PROMPT },
		{ role: 'user', content: `Here is the git diff to review:\n\n\`\`\`diff\n${diffText}\n\`\`\`` },
	];
}

export function truncateDiff(diff, maxChars) {
	if (diff.length <= maxChars) return { text: diff, truncated: false };
	return {
		text: `${diff.slice(0, maxChars)}\n\n[... diff truncated at ${maxChars} characters; raise localReview.maxDiffChars to see more ...]`,
		truncated: true,
	};
}

// --- Report -----------------------------------------------------------------------------
export function formatReport({ baseRef, mergeBase, timestamp, diffStat, findings, truncated, scope }) {
	const lines = [];
	lines.push('# Local review report');
	lines.push('');
	lines.push('> Advisory only. Generated by `npm run review` against a local llama.cpp model (Ornith 1.0). This is a first-pass filter, not a substitute for `/code-review` or human judgment. It always exits 0.');
	lines.push('');
	lines.push(`- Base ref: \`${baseRef}\``);
	lines.push(`- Merge base: \`${mergeBase}\``);
	lines.push(`- Scope: ${scopeLabel(scope)}`);
	lines.push(`- Generated: ${timestamp}`);
	if (truncated) lines.push('- Note: the diff was truncated before review (exceeded `localReview.maxDiffChars`).');
	lines.push('');
	lines.push('## Diff stat');
	lines.push('');
	lines.push('```');
	lines.push((diffStat || '').trim() || '(no changes)');
	lines.push('```');
	lines.push('');
	lines.push('## Findings');
	lines.push('');
	lines.push((findings || '').trim() || '(no findings returned)');
	lines.push('');
	return lines.join('\n');
}

// --- Runtime (not exported; not unit-tested) --------------------------------------------

function printError(msg) {
	console.error(`\nERROR: local review could not run.\n\n${msg}\n\n(This is advisory tooling; exiting 0 so it never blocks your build-and-test loop.)\n`);
}

function delay(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPortReachable(port, host = '127.0.0.1') {
	return new Promise((resolve) => {
		let settled = false;
		const done = (reachable, socket) => {
			if (settled) return;
			settled = true;
			try { socket?.destroy(); } catch { /* best effort */ }
			resolve(reachable);
		};
		try {
			const socket = createConnection({ host, port });
			socket.once('connect', () => done(true, socket));
			socket.once('error', () => done(false, socket));
		} catch {
			done(false);
		}
	});
}

// Deliberate simplification vs WhisperHost: no PID sidecar / cross-session adoption. This
// is a one-shot run-and-exit script, so "adopt" just means "the port is already reachable,
// use it and leave it running"; "spawn" means we start it and stop it in the finally block.
function spawnServer(config) {
	const extra = splitArgs(config.extraArgs);
	const hostArgs = getHostArgs(extra);
	const args = [
		'-m', config.modelPath,
		'--port', String(config.port),
		...(hostArgs.length === 0 ? ['--host', '127.0.0.1'] : []),
		...extra,
	];
	const child = spawn(config.binaryPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
	let log = '';
	const append = (s) => {
		log += s;
		if (log.length > MAX_LOG_BYTES) log = log.slice(-MAX_LOG_BYTES);
	};
	child.stdout?.on('data', (d) => append(d.toString()));
	child.stderr?.on('data', (d) => append(d.toString()));
	const handle = { child, exited: false, getLog: () => log };
	child.on('exit', () => { handle.exited = true; });
	return handle;
}

// llama-server can bind the port before the model finishes loading, so a single failed
// request is not fatal: poll GET /health (503 while loading, 200 when ready) up to the
// deadline. Returns false if the child died or the deadline passed.
async function waitForReady(baseUrl, deadline, handle) {
	while (Date.now() < deadline) {
		if (handle?.exited) return false;
		try {
			const res = await fetch(`${baseUrl}/health`, { method: 'GET' });
			if (res.ok) return true;
		} catch { /* not up yet */ }
		await delay(READY_POLL_MS);
	}
	return false;
}

async function stopServer(handle) {
	const { child } = handle;
	await new Promise((resolve) => {
		let settled = false;
		const finish = () => {
			if (settled) return;
			settled = true;
			clearTimeout(killTimer);
			resolve();
		};
		const killTimer = setTimeout(() => {
			try { child.kill('SIGKILL'); } catch { /* best effort */ }
			finish();
		}, STOP_KILL_GRACE_MS);
		child.once('exit', finish);
		try { child.kill(); } catch { finish(); }
	});
}

async function postReview(baseUrl, messages, requestTimeoutMs) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
	try {
		const res = await fetch(`${baseUrl}/v1/chat/completions`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ messages, temperature: 0.2, stream: false, max_tokens: 4096 }),
			signal: controller.signal,
		});
		if (!res.ok) {
			const body = await res.text().catch(() => '');
			throw new Error(`llama-server returned HTTP ${res.status}. ${body.slice(0, 300)}`);
		}
		const data = await res.json();
		return data?.choices?.[0]?.message?.content ?? '(no content returned by the model)';
	} finally {
		clearTimeout(timer);
	}
}

async function main() {
	const repoRoot = dirname(fileURLToPath(import.meta.url));
	const configPath = join(repoRoot, 'dev-tools.config.json');
	if (!existsSync(configPath)) {
		printError(`No dev-tools.config.json found at ${configPath}.\nCopy dev-tools.config.example.json to dev-tools.config.json and fill in localReview.binaryPath and localReview.modelPath.`);
		return;
	}

	let config;
	try {
		const raw = JSON.parse(readFileSync(configPath, 'utf8'));
		config = parseLocalReviewConfig(raw);
	} catch (e) {
		printError(`Could not load dev-tools.config.json: ${e.message}`);
		return;
	}

	const badHost = getHostArgs(splitArgs(config.extraArgs)).find((h) => !isLoopbackHost(h));
	if (badHost !== undefined) {
		printError(`Refusing to start: --host ${badHost || '(empty)'} in localReview.extraArgs would bind llama-server to a non-loopback interface. llama-server has no auth or TLS. Remove it.`);
		return;
	}

	const cli = parseCliArgs(process.argv.slice(2));
	const baseRef = cli.base ?? config.baseRef;

	let mergeBase;
	let diff;
	let diffStat;
	try {
		mergeBase = execFileSync('git', ['merge-base', baseRef, 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
		diff = execFileSync('git', buildDiffArgs(cli, mergeBase), { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
		diffStat = execFileSync('git', buildDiffArgs(cli, mergeBase, { stat: true }), { cwd: repoRoot, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
	} catch (e) {
		printError(`git failed (is "${baseRef}" a valid ref?): ${e.message}`);
		return;
	}

	if (!diff.trim()) {
		console.log(`Nothing to review: no diff for scope "${scopeLabel(cli)}" against ${baseRef}. Skipping the model call.`);
		return;
	}

	const { text: diffText, truncated } = truncateDiff(diff, config.maxDiffChars);
	const baseUrl = `http://127.0.0.1:${config.port}`;

	let spawned = null;
	try {
		if (await isPortReachable(config.port)) {
			console.log(`Port ${config.port} is already reachable; adopting the running llama-server (it will be left running).`);
		} else {
			console.log(`Starting llama-server on ${baseUrl} (model load can take a while)...`);
			spawned = spawnServer(config);
			const ready = await waitForReady(baseUrl, Date.now() + config.readyTimeoutMs, spawned);
			if (!ready) {
				const tail = spawned.getLog().slice(-800);
				throw new Error(`llama-server did not become ready within ${config.readyTimeoutMs / 1000}s (raise localReview.readyTimeoutMs if your disk/GPU load is slow). Log tail:\n${tail || '(empty)'}`);
			}
		}

		console.log('Sending the diff to the model for review...');
		const findings = await postReview(baseUrl, buildReviewMessages(diffText), config.requestTimeoutMs);

		const report = formatReport({
			baseRef,
			mergeBase,
			timestamp: new Date().toISOString(),
			diffStat,
			findings,
			truncated,
			scope: cli,
		});

		const reportPath = join(repoRoot, 'docs', 'claude-scratch', 'local-review-report.md');
		mkdirSync(dirname(reportPath), { recursive: true });
		writeFileSync(reportPath, report);

		console.log(`\n${'='.repeat(72)}\n${findings.trim()}\n${'='.repeat(72)}\n`);
		console.log(`Report written to ${reportPath}`);
	} catch (e) {
		printError(e.message);
	} finally {
		if (spawned) {
			console.log('Stopping the llama-server we started...');
			await stopServer(spawned);
		}
	}
}

// Side effects run only when invoked as a script, not when imported by a test.
if (fileURLToPath(import.meta.url) === process.argv[1]) {
	main()
		.then(() => process.exit(0))
		.catch((e) => {
			printError(e?.message ?? String(e));
			process.exit(0);
		});
}
