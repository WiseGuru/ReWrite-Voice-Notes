import { describe, expect, it } from 'vitest';
import {
	CODE_PATHS,
	DOC_PATHS,
	buildDiffArgs,
	buildReviewMessages,
	formatReport,
	getHostArgs,
	isLoopbackHost,
	parseCliArgs,
	parseLocalReviewConfig,
	pathsForMode,
	scopeLabel,
	splitArgs,
	truncateDiff,
	untrackedArgs,
} from '../local-review.mjs';

// The loopback guard is duplicated from src/whisper-host.ts on purpose (see the comment in
// local-review.mjs); mirror test/whisper-host.test.ts so the copy keeps the same coverage.
describe('getHostArgs', () => {
	it('returns an empty array when no --host is present', () => {
		expect(getHostArgs(['-m', 'model.gguf', '--port', '8090'])).toEqual([]);
	});

	it('collects a single --host value (space form)', () => {
		expect(getHostArgs(['--host', '127.0.0.1'])).toEqual(['127.0.0.1']);
	});

	it('collects a single --host value (= form)', () => {
		expect(getHostArgs(['--host=127.0.0.1'])).toEqual(['127.0.0.1']);
	});

	it('collects every --host occurrence, not just the first', () => {
		expect(getHostArgs(['--host', '127.0.0.1', '--host', '0.0.0.0'])).toEqual(['127.0.0.1', '0.0.0.0']);
	});

	it('treats a --host with no following value as empty string', () => {
		expect(getHostArgs(['--host'])).toEqual(['']);
	});
});

describe('isLoopbackHost', () => {
	it.each([
		['127.0.0.1', true],
		['localhost', true],
		['LOCALHOST', true],
		['::1', true],
		['[::1]', true],
		['  127.0.0.1  ', true],
		['0.0.0.0', false],
		['192.168.1.5', false],
		['example.com', false],
		['', false],
	])('isLoopbackHost(%s) === %s', (host, expected) => {
		expect(isLoopbackHost(host)).toBe(expected);
	});
});

describe('splitArgs', () => {
	it('returns an empty array for empty/whitespace input', () => {
		expect(splitArgs('')).toEqual([]);
		expect(splitArgs('   ')).toEqual([]);
	});

	it('splits on runs of whitespace', () => {
		expect(splitArgs('--ctx-size  4096   --threads 8')).toEqual(['--ctx-size', '4096', '--threads', '8']);
	});
});

describe('parseCliArgs', () => {
	it('defaults to no flags', () => {
		expect(parseCliArgs([])).toEqual({ base: null, staged: false, full: false, mode: 'code' });
	});

	it('reads --base with a following value', () => {
		expect(parseCliArgs(['--base', 'main'])).toEqual({ base: 'main', staged: false, full: false, mode: 'code' });
	});

	it('reads --base=value form', () => {
		expect(parseCliArgs(['--base=develop'])).toEqual({ base: 'develop', staged: false, full: false, mode: 'code' });
	});

	it('reads --staged and --full', () => {
		expect(parseCliArgs(['--staged'])).toMatchObject({ staged: true });
		expect(parseCliArgs(['--full'])).toMatchObject({ full: true });
	});

	it('defaults mode to code and reads --docs / --code / --mode', () => {
		expect(parseCliArgs([]).mode).toBe('code');
		expect(parseCliArgs(['--docs']).mode).toBe('docs');
		expect(parseCliArgs(['--code']).mode).toBe('code');
		expect(parseCliArgs(['--mode', 'docs']).mode).toBe('docs');
		expect(parseCliArgs(['--mode=docs']).mode).toBe('docs');
		// unknown mode value falls back to code
		expect(parseCliArgs(['--mode', 'wat']).mode).toBe('code');
	});
});

describe('pathsForMode', () => {
	it('returns code paths by default and doc paths for docs', () => {
		expect(pathsForMode('code')).toBe(CODE_PATHS);
		expect(pathsForMode('docs')).toBe(DOC_PATHS);
		expect(pathsForMode('anything-else')).toBe(CODE_PATHS);
	});

	it('code scope covers src and styles; doc scope is markdown', () => {
		expect(CODE_PATHS).toContain('src/');
		expect(CODE_PATHS).toContain('styles.css');
		expect(DOC_PATHS).toEqual(['*.md']);
	});
});

describe('untrackedArgs', () => {
	it('lists untracked, non-ignored files within the pathspec', () => {
		expect(untrackedArgs(['src/'])).toEqual(['ls-files', '--others', '--exclude-standard', '--', 'src/']);
	});

	it('omits the pathspec separator when no paths are given', () => {
		expect(untrackedArgs([])).toEqual(['ls-files', '--others', '--exclude-standard']);
	});
});

describe('buildDiffArgs', () => {
	it('diffs the merge-base against the working tree by default', () => {
		expect(buildDiffArgs({ staged: false, full: false }, 'abc123')).toEqual(['diff', 'abc123']);
	});

	it('narrows to the index with --staged', () => {
		expect(buildDiffArgs({ staged: true, full: false }, 'abc123')).toEqual(['diff', '--staged']);
	});

	it('narrows to the last commit with --full', () => {
		expect(buildDiffArgs({ staged: false, full: true }, 'abc123')).toEqual(['diff', 'HEAD~1', 'HEAD']);
	});

	it('adds --stat when requested', () => {
		expect(buildDiffArgs({ staged: false, full: false }, 'abc123', { stat: true })).toEqual(['diff', '--stat', 'abc123']);
	});

	it('appends a pathspec after the range', () => {
		expect(buildDiffArgs({ staged: false, full: false }, 'abc123', { paths: ['src/', 'styles.css'] }))
			.toEqual(['diff', 'abc123', '--', 'src/', 'styles.css']);
	});

	it('combines stat and pathspec', () => {
		expect(buildDiffArgs({ staged: false, full: false }, 'abc123', { stat: true, paths: ['*.md'] }))
			.toEqual(['diff', '--stat', 'abc123', '--', '*.md']);
	});
});

describe('scopeLabel', () => {
	it('describes each scope distinctly', () => {
		const def = scopeLabel({ staged: false, full: false });
		const staged = scopeLabel({ staged: true, full: false });
		const full = scopeLabel({ staged: false, full: true });
		expect(new Set([def, staged, full]).size).toBe(3);
		expect(staged).toMatch(/staged/i);
		expect(full).toMatch(/commit/i);
	});
});

describe('truncateDiff', () => {
	it('leaves a short diff untouched', () => {
		expect(truncateDiff('abc', 60000)).toEqual({ text: 'abc', truncated: false });
	});

	it('truncates and marks an over-long diff', () => {
		const long = 'x'.repeat(200);
		const out = truncateDiff(long, 50);
		expect(out.truncated).toBe(true);
		expect(out.text.startsWith('x'.repeat(50))).toBe(true);
		expect(out.text).toMatch(/truncated at 50 characters/);
	});
});

describe('parseLocalReviewConfig', () => {
	const ok = { localReview: { binaryPath: '/bin/llama-server', modelPath: '/models/ornith.gguf' } };
	const yes = () => true;

	it('throws when the top-level value is not an object', () => {
		expect(() => parseLocalReviewConfig(null, yes)).toThrow(/JSON object/);
	});

	it('throws when localReview is missing', () => {
		expect(() => parseLocalReviewConfig({}, yes)).toThrow(/localReview/);
	});

	it('throws when binaryPath is empty', () => {
		expect(() => parseLocalReviewConfig({ localReview: { modelPath: '/m' } }, yes)).toThrow(/binaryPath/);
	});

	it('throws when modelPath is empty', () => {
		expect(() => parseLocalReviewConfig({ localReview: { binaryPath: '/b' } }, yes)).toThrow(/modelPath/);
	});

	it('throws when a configured path does not exist', () => {
		expect(() => parseLocalReviewConfig(ok, () => false)).toThrow(/does not exist/);
	});

	it('applies defaults for optional fields', () => {
		const cfg = parseLocalReviewConfig(ok, yes);
		expect(cfg).toMatchObject({
			binaryPath: '/bin/llama-server',
			modelPath: '/models/ornith.gguf',
			port: 8090,
			extraArgs: '',
			baseRef: 'master',
			readyTimeoutMs: 60000,
			requestTimeoutMs: 300000,
			maxDiffChars: 60000,
			maxOutputTokens: 8192,
		});
	});

	it('keeps valid custom values and rejects an out-of-range port', () => {
		const cfg = parseLocalReviewConfig({
			localReview: { binaryPath: '/b', modelPath: '/m', port: 70000, baseRef: 'dev', maxDiffChars: 1000 },
		}, yes);
		expect(cfg.port).toBe(8090); // 70000 > 65535 falls back to default
		expect(cfg.baseRef).toBe('dev');
		expect(cfg.maxDiffChars).toBe(1000);
	});

	it('trims path values', () => {
		const cfg = parseLocalReviewConfig({ localReview: { binaryPath: '  /b  ', modelPath: ' /m ' } }, yes);
		expect(cfg.binaryPath).toBe('/b');
		expect(cfg.modelPath).toBe('/m');
	});
});

describe('buildReviewMessages', () => {
	it('produces a system + user pair carrying the diff', () => {
		const msgs = buildReviewMessages('diff body');
		expect(msgs).toHaveLength(2);
		expect(msgs[0].role).toBe('system');
		expect(msgs[1].role).toBe('user');
		expect(msgs[1].content).toContain('diff body');
	});

	it('uses a different system prompt for docs mode than code mode', () => {
		const code = buildReviewMessages('x', 'code')[0].content;
		const docs = buildReviewMessages('x', 'docs')[0].content;
		expect(code).not.toBe(docs);
		expect(docs).toMatch(/consisten|contradict|stale/i);
		expect(code).toMatch(/correctness|bug/i);
	});
});

describe('formatReport', () => {
	it('includes the header fields and findings', () => {
		const report = formatReport({
			baseRef: 'master',
			mergeBase: 'deadbeef',
			timestamp: '2026-07-07T00:00:00.000Z',
			diffStat: ' src/main.ts | 2 +-',
			findings: 'Looks fine.',
			truncated: false,
			scope: { staged: false, full: false },
		});
		expect(report).toContain('master');
		expect(report).toContain('deadbeef');
		expect(report).toContain('Looks fine.');
		expect(report).toContain('src/main.ts');
		expect(report).not.toContain('was truncated');
	});

	it('reflects the review mode and untracked-file count in the header', () => {
		const report = formatReport({
			baseRef: 'master',
			mergeBase: 'deadbeef',
			timestamp: 't',
			diffStat: '',
			findings: 'ok',
			truncated: false,
			scope: { staged: false, full: false },
			mode: 'docs',
			untrackedCount: 2,
		});
		expect(report).toContain('# Local review report (docs)');
		expect(report).toMatch(/2 untracked file/);
	});

	it('notes truncation when set', () => {
		const report = formatReport({
			baseRef: 'master',
			mergeBase: 'deadbeef',
			timestamp: 't',
			diffStat: '',
			findings: '',
			truncated: true,
			scope: { staged: false, full: false },
		});
		expect(report).toMatch(/truncated/);
		expect(report).toContain('(no findings returned)');
	});
});
