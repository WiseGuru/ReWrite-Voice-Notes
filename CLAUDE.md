# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project state

**Implementation in progress against [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md). The live status of each phase (what's committed, what's uncommitted, architectural decisions made along the way) is in [docs/claude-scratch/STATUS.md](docs/claude-scratch/STATUS.md). Read STATUS.md first; it is more current than the rest of this section, which will be rewritten wholesale in Phase 13.**

This repo is becoming the **ReWrite (Voice Notes) plugin for Obsidian**. The spec (providers, profile system, modal UX, templates, settings layout, API request shapes) lives in [obsidian-voice-notes-spec.md](obsidian-voice-notes-spec.md), which is still the source of truth for behavior.

When implementing spec features, follow the file layout the spec prescribes (provider adapters under `src/transcription/` and `src/llm/`, factories in each `index.ts`, no provider-specific logic leaking outside its own file).

## Documentation maintenance
Update CLAUDE.md with every behavioral change. When modifying code that this document describes (pipeline step count, step responsibilities, CLI flags, config keys, constants like `_SECTION_ORDER`, hardware/model defaults, caching behavior, gotchas), update CLAUDE.md in the same change. If a behavioral change has no existing section, add one or drop a note under "Gotchas". Treat the doc update as part of the task, not a follow-up.

## Commands

```bash
npm install        # install deps
npm run dev        # esbuild watch mode → bundles src/main.ts to ./main.js with inline sourcemaps
npm run build      # tsc -noEmit type-check, then esbuild production (minified, no sourcemaps)
npm run lint       # eslint over the repo (uses eslint-plugin-obsidianmd recommended)
npm version <patch|minor|major>  # bumps manifest.json + versions.json via version-bump.mjs
```

There is no test runner configured.

CI ([.github/workflows/lint.yml](.github/workflows/lint.yml)) runs `npm ci`, `npm run build`, and `npm run lint` on Node 20.x and 22.x for every push/PR.

## Build architecture

- Entry: [src/main.ts](src/main.ts) → bundled to `./main.js` at repo root (the file Obsidian loads).
- Bundler: [esbuild.config.mjs](esbuild.config.mjs). `obsidian`, `electron`, all `@codemirror/*`, all `@lezer/*`, and Node built-ins are marked `external` — never import other runtime deps without bundling them in.
- Release artifacts are `main.js`, `manifest.json`, and `styles.css` at the repo root. Do not commit the generated `main.js`.
- TypeScript config ([tsconfig.json](tsconfig.json)) is strict: `noImplicitAny`, `strictNullChecks`, `noImplicitReturns`, `noUncheckedIndexedAccess`, `useUnknownInCatchVariables`, `baseUrl: "src"`. Target ES6, module ESNext, lib DOM + ES5/6/7 only — no Node lib, so don't reach for Node APIs in plugin code.
- ESLint ([eslint.config.mts](eslint.config.mts)) layers `eslint-plugin-obsidianmd`'s recommended rules on top of `typescript-eslint`. These rules encode Obsidian-specific correctness checks; respect them rather than disabling.

## Code style

Per [.editorconfig](.editorconfig): tabs (width 4), LF, UTF-8, final newline. Matches the existing source.

## Obsidian plugin conventions

[AGENTS.md](AGENTS.md) has the full Obsidian-specific playbook. The non-obvious rules that actually constrain implementation:

- **Never change `manifest.json`'s `id` after release** — it's a stable identifier.
- **Use `this.register*` helpers** (`registerEvent`, `registerDomEvent`, `registerInterval`) for anything that needs cleanup — otherwise reload/unload leaks.
- **Mobile compatibility**: avoid Node/Electron APIs unless `manifest.json` sets `isDesktopOnly: true`. Current manifest is `false`, and the spec's mobile profile depends on this (Web Speech API path).
- **Keep [src/main.ts](src/main.ts) minimal** — only plugin lifecycle (onload/onunload, command registration, settings tab registration). Feature logic belongs in dedicated modules.
- **Defer heavy work**: no long tasks in `onload`. Lazy-init providers/recorders when first used.
- **Network policy**: provider calls go to user-configured endpoints with user-provided keys. No telemetry, no auto-update of plugin code, no fetch+eval.
- **Releases**: GitHub release tag must exactly match `manifest.json`'s `version` (no leading `v`). Attach `main.js`, `manifest.json`, `styles.css` as individual binary assets (not zipped).

## Local install for testing

Build, then place/symlink `main.js`, `manifest.json`, and `styles.css` into `<Vault>/.obsidian/plugins/<plugin-id>/` and reload Obsidian (Settings → Community plugins).


## Never use em dashes in your own writing.
Do not use the em dash character (—) in any prose, lists, code comments, or analysis you produce. Use commas, periods, parentheses, semicolons, or colons instead, whichever fits the sentence best. Exception: when directly quoting a source inside quotation marks, preserve em dashes exactly as they appear. Do not silently edit quoted text.
Why: Consistent formatting preference for original writing, while keeping quoted material faithful to the source.
