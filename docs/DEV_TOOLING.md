# Dev tooling: local review + release prep

> Extracted from CLAUDE.md. Subject to the same maintenance rule: when you change the behavior of either script or the shared config, update this file in the same change, and keep the summary in [CLAUDE.md](../CLAUDE.md) accurate.

Two `.mjs`-at-root scripts (same convention as [version-bump.mjs](../version-bump.mjs) / [esbuild.config.mjs](../esbuild.config.mjs): plain ESM, no TypeScript, no new runtime dependency, side effects guarded behind `import.meta.url === process.argv[1]` so the pure logic is unit-testable) plus a project-level Claude Code skill. They exist because Obsidian plugins have **no headless UI test harness**, so UI event-wiring bugs (the `isLocked()` self-lockout, a `--host` bypass, a greedy YAML-fence regex) sail past `npm run build`, `npm run lint`, and the Vitest suite. These tools add a cheap local review pass and a kept-current manual release checklist to catch that class of bug.

## Shared config: `dev-tools.config.json`

Both scripts read one gitignored file at the repo root, `dev-tools.config.json` (one config file, one `.gitignore` entry, one doc section). No baked defaults, mirroring `LocalWhisperSettings` in [src/whisper-host.ts](../src/whisper-host.ts): required paths are validated present + `existsSync` before use, with a clear thrown message otherwise. [dev-tools.config.example.json](../dev-tools.config.example.json) is the committed fill-in-and-rename template; its `//`-prefixed keys carry the confirmed paths for this machine as comments while the real JSON values stay empty strings (it is a personal-machine config, not something to bake into the repo).

```jsonc
{
  "localReview": {
    "binaryPath": "",       // required: path to llama-server(.exe)
    "modelPath": "",        // required: path to the Ornith 1.0 gguf
    "port": 8090,
    "extraArgs": "",        // whitespace-split; a non-loopback --host is rejected
    "baseRef": "master",    // diff is computed against this ref
    "readyTimeoutMs": 60000,
    "requestTimeoutMs": 300000,
    "maxDiffChars": 60000
  },
  "releaseVault": {
    "vaultPath": ""         // required: a SCRATCH Obsidian vault, never a personal one
  }
}
```

## `npm run review` — advisory local code review ([local-review.mjs](../local-review.mjs))

A one-shot, **always-exits-0**, advisory pass over the current diff, run against a locally-hosted llama.cpp model (Ornith 1.0, a 35B Q4_K_M quant, ~19.7 GB) before loading a build into Obsidian to test it by hand. It never blocks the build; it is a first-pass filter that costs no Anthropic tokens per local build-and-test cycle. It is invoked manually, not auto-chained into `npm run build`.

**Diff scope.** `git merge-base <baseRef> HEAD` then `git diff <mergeBase>` against the working tree, i.e. everything staged + unstaged + committed-since-branch ("everything you're about to go test"). `--staged` narrows to the index; `--full` to the last commit only; `--base <ref>` overrides the configured `baseRef`. An empty diff prints "nothing to review" and skips the model call entirely. All git calls go through `execFileSync('git', [...])` (never `execSync` — no shell interpolation); this is the first code in the repo shelling out to git.

**llama-server lifecycle** mirrors `WhisperHost`'s probe -> spawn-if-needed -> poll-ready -> use -> stop-only-if-we-started-it, simplified to a run-and-exit script (no PID sidecar / cross-session adoption — "adopt" here just means the port is already reachable, so use it and leave it running). If not reachable, it spawns `llama-server -m <model> --port <port> --host 127.0.0.1 [extraArgs]`, captures stdout/stderr into a bounded ring buffer, and polls `GET /health` every 250 ms up to `readyTimeoutMs` (default 60 s; the GGUF load is far slower than whisper's 5 s deadline, and llama-server can bind the port before the model finishes loading, so a single failed health check is not fatal). It then POSTs the diff to llama-server's native OpenAI-compatible `/v1/chat/completions` with an `AbortController`-driven `requestTimeoutMs`. In the `finally`, a spawned process is SIGTERM'd then SIGKILL'd after a grace period; an adopted one is left running.

**Prompt.** The system prompt asks for correctness bugs + simplification/reuse/efficiency (the `/code-review` sensibilities), plus an explicit repo-specific callout to flag DOM event wiring / enable-disable state / button lifecycle (the exact class of bug that motivated the tool) and a few house rules from [RELEASING.md](RELEASING.md)'s guideline-conflict checklist (no `!important`, no `eslint-disable`, popout-window safety). The user message is the diff, truncated to `maxDiffChars` with a visible marker.

**Output.** Findings print to stdout and are always also written to `docs/claude-scratch/local-review-report.md` (fixed name, overwritten each run; the folder is already gitignored). The report header carries the base ref, merge-base SHA, scope, timestamp, and a diff-stat. Setup errors (missing config, git failure, server never ready, a non-loopback `--host`) print a clearly marked `ERROR:` block, never a stack trace, and still exit 0.

The loopback guard (`getHostArgs` + `isLoopbackHost` + `splitArgs`) is **duplicated** from [src/whisper-host.ts](../src/whisper-host.ts) on purpose: that file's top-level `import ... from 'obsidian'` only resolves inside the Obsidian bundle (or behind the Vitest alias), so it can't be imported from plain Node. The copies carry the same test coverage the originals have in [test/whisper-host.test.ts](../test/whisper-host.test.ts), in [test/local-review.test.ts](../test/local-review.test.ts).

## `npm run release:prep` — build + install into a scratch vault ([prepare-release-vault.mjs](../prepare-release-vault.mjs))

Unlike the review script, this **fails loudly** (non-zero exit) on error — there is no advisory framing for release prep. It reads `releaseVault.vaultPath` (validated to exist up front, before any build or directory creation, so a bad path fails fast with no stray directory), warns (but does not hard-fail) when the vault has no `.obsidian` subfolder (an unopened vault), runs `npm run build` via `execFileSync`, reads the plugin id from `manifest.json` (derived, not duplicated), copies `main.js` / `manifest.json` / `styles.css` into `<vaultPath>/.obsidian/plugins/rewrite-voice-notes/`, and prints a reminder to reload/toggle the plugin in Obsidian (the one step it cannot automate).

## `release-checklist` skill ([.claude/skills/release-checklist/](../.claude/skills/release-checklist/))

The first project-level Claude Code skill in this repo. Two files, mirroring the repo's summary + linked-deep-dive convention:

- `SKILL.md` — process-oriented: setup check, run `prepare-release-vault.mjs`, walk `CHECKLIST.md` area by area recording PASS/FAIL/SKIP, then summarize a go/no-go. Filled-out runs save to `docs/claude-scratch/release-checklist-<version>.md`.
- `CHECKLIST.md` — the full feature-by-feature matrix, kept separate so future feature additions are a content-only edit and a human can run it standalone (no Claude Code needed). It replaces the stale "Testing Checklist" in [obsidian-voice-notes-spec.md](../obsidian-voice-notes-spec.md) (which referenced 5 templates instead of 10, a removed `webspeech` provider, a flat 60 s poll timeout, and a removed clipboard fallback). **Keep it in sync with the feature set** the same way CLAUDE.md and the wiki are: a feature change updates the checklist in the same change.

## Gotchas

- **The review script always exits 0.** It is advisory. A missing config, a git error, or a server that never became ready prints an `ERROR:` block and exits 0, never a non-zero code, so it can never block the local loop. `prepare-release-vault.mjs` is the opposite: it exits 1 on any failure.
- **The loopback guard is duplicated, not imported.** `getHostArgs` / `isLoopbackHost` / `splitArgs` live in both `src/whisper-host.ts` and `local-review.mjs`. If you change the guard's behavior, change both and update both test files. This duplication is deliberate (the src copy can't load in plain Node).
- **No cross-session process adoption.** Unlike `WhisperHost`, the review script has no PID sidecar. "Adopt" means only "the port is reachable, reuse it and leave it running." A TCP-reachable port is assumed to be llama-server; a dev tool doesn't need the full ownership model.
- **`npm` is `npm.cmd` on Windows.** `prepare-release-vault.mjs` picks the binary by `process.platform`, since `execFileSync('npm', ...)` would fail to resolve on Windows.
- **The Ornith model is large.** `readyTimeoutMs`'s 60 s default may be tight depending on disk speed / GPU offload. Raise it (rather than guessing a bigger number blind) if you see spurious ready-timeout errors.
