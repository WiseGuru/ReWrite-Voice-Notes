# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project state

This is the **ReWrite (Voice Notes) plugin for Obsidian**: record or paste speech, transcribe via a user-configured provider, clean and structure via an LLM, insert per a chosen template. Desktop and mobile.

The v1 implementation is feature-complete against [obsidian-voice-notes-spec.md](obsidian-voice-notes-spec.md) and [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md). The spec is still the source of truth for behavior; the implementation plan resolves the spec's internal discrepancies (notably manifest id, base URL handling for `openai-compatible`, and mobile `safeStorage` unavailability). [docs/claude-scratch/STATUS.md](docs/claude-scratch/STATUS.md) tracks per-phase commit state and the running list of architectural decisions made during implementation; consult it when picking up work or before changing anything cross-cutting.

When extending the plugin, follow the file layout the spec prescribes: provider adapters under `src/transcription/` and `src/llm/`, factories in each `index.ts`, no provider-specific logic leaking outside its own file.

**Pre-release status: no migrations, no backcompat shims.** There are no real users yet. When changing settings shape, `data.json` keys, `secrets.json.nosync` schema, template structure, or any other persisted format: change it cleanly. Do not write migration code, do not add compatibility read paths, do not preserve deprecated fields "just in case." Existing dev installs can be reset by deleting `data.json` / `secrets.json.nosync`. Drop this rule the moment v1.0.0 ships to the community plugin directory.

## Documentation maintenance

Update CLAUDE.md with every behavioral change. When modifying code that this document describes (pipeline stages, command IDs, settings keys, gotchas, conventions), update CLAUDE.md in the same change. If a behavioral change has no existing section, add one or drop a note under "Gotchas". Treat the doc update as part of the task, not a follow-up.

## Commands

```bash
npm install        # install deps
npm run dev        # esbuild watch mode → bundles src/main.ts to ./main.js with inline sourcemaps
npm run build      # tsc -noEmit type-check, then esbuild production (minified, no sourcemaps)
npm run lint       # eslint over the repo (uses eslint-plugin-obsidianmd recommended)
npm version <patch|minor|major>  # bumps manifest.json + versions.json via version-bump.mjs
```

There is no test runner configured. Verification is `npm run build && npm run lint` (CI parity) plus the manual checklist in [obsidian-voice-notes-spec.md](obsidian-voice-notes-spec.md) (lines 454-476).

CI ([.github/workflows/lint.yml](.github/workflows/lint.yml)) runs `npm ci`, `npm run build`, and `npm run lint` on Node 20.x and 22.x for every push/PR.

## Build architecture

- Entry: [src/main.ts](src/main.ts) → bundled to `./main.js` at repo root (the file Obsidian loads). Kept minimal: settings load, ribbon icon, two commands, settings tab, plus a single `activeQuickRecord` ref so the Quick Record command can toggle.
- Bundler: [esbuild.config.mjs](esbuild.config.mjs). `obsidian`, `electron`, all `@codemirror/*`, all `@lezer/*`, and Node built-ins are marked `external`. Never import other runtime deps without bundling them in.
- Release artifacts are `main.js`, `manifest.json`, and `styles.css` at the repo root. Do not commit the generated `main.js`.
- TypeScript config ([tsconfig.json](tsconfig.json)) is strict: `noImplicitAny`, `strictNullChecks`, `noImplicitReturns`, `noUncheckedIndexedAccess`, `useUnknownInCatchVariables`, `baseUrl: "src"`. Target ES6, module ESNext, lib DOM + ES5/6/7 only. No Node lib, so don't reach for Node APIs in plugin code.
- ESLint ([eslint.config.mts](eslint.config.mts)) layers `eslint-plugin-obsidianmd`'s recommended rules on top of `typescript-eslint`. These rules encode Obsidian-specific correctness checks; respect them rather than disabling.

## Source layout

```
src/
├── main.ts                          # Lifecycle, commands, ribbon, settings tab registration
├── types.ts                         # Shared interfaces (provider IDs, configs, templates, settings)
├── http.ts                          # requestUrl wrappers: jsonPost/jsonGet/multipartPost + ProviderError
├── platform.ts                      # Active-profile resolver + MediaRecorder/Web Speech availability probes
├── secrets.ts                       # safeStorage (desktop) + plaintext fallback (mobile) for API keys
├── recorder.ts                      # MediaRecorder state machine + getBestMimeType + 25 MB size guard
├── webspeech.ts                     # SpeechRecognition wrapper
├── pipeline.ts                      # transcribe → cleanup → insert orchestrator
├── insert.ts                        # cursor/newFile/append + {{date}}/{{time}} expansion
├── settings/
│   ├── index.ts                     # DEFAULT_SETTINGS, load/save, per-profile secret hydration
│   ├── tab.ts                       # PluginSettingTab: active profile, two profile sections, templates, recording
│   └── default-templates.ts         # The 5 seeded templates (General cleanup, Todo list, etc.)
├── ui/
│   ├── modal.ts                     # Main modal: template select + Record/Paste tabs + setup-card injection
│   ├── setup-card.ts                # Inline blocker when active profile is unconfigured
│   └── quick-record.ts              # QuickRecordController + floating mini-UI for the Quick Record command
├── transcription/
│   ├── index.ts                     # TranscriptionProvider interface + createTranscriptionProvider()
│   ├── openai.ts                    # Whisper-shape POST (also used by openai-compatible + groq)
│   ├── assemblyai.ts                # upload → submit → poll
│   ├── deepgram.ts                  # single POST
│   ├── revai.ts                     # submit → poll → fetch text
│   └── webspeech.ts                 # adapter; throws "should not be called" (see Gotchas)
└── llm/
    ├── index.ts                     # LLMProvider interface + createLLMProvider()
    ├── openai.ts                    # /v1/chat/completions (also used by openai-compatible + mistral)
    ├── anthropic.ts                 # /v1/messages
    └── gemini.ts                    # :generateContent
```

## Pipeline

[src/pipeline.ts](src/pipeline.ts) runs three stages with `onStage` callbacks for UI:

1. **Transcribe**: `audio` → `createTranscriptionProvider(profile.transcriptionProvider).transcribe(blob, config)`. Skipped when the source is `paste` (text passes through). Short-circuited when the source is `webspeech` (the transcript was already captured live by `src/webspeech.ts` during recording).
2. **Cleanup**: `createLLMProvider(profile.llmProvider).complete(template.prompt, transcript, config)`. On error, the raw transcript is copied to the clipboard before re-throwing, so the user keeps their words.
3. **Insert**: `src/insert.ts` routes to `cursor` / `newFile` / `append` per the template. `cursor` falls back to `append` when no editor is active; `append` falls back to `newFile` when no markdown file exists. `{{date}}` / `{{time}}` in filename templates expand via Obsidian's `moment`.

The pipeline accepts an `AbortSignal` (forwarded to providers) and is consumed by both [src/ui/modal.ts](src/ui/modal.ts) and [src/ui/quick-record.ts](src/ui/quick-record.ts).

## Provider system

[src/transcription/index.ts](src/transcription/index.ts) and [src/llm/index.ts](src/llm/index.ts) each define a small interface plus a `create...Provider(id)` factory. Provider families share one adapter file: OpenAI Whisper, `openai-compatible`, and Groq all dispatch into [src/transcription/openai.ts](src/transcription/openai.ts) with different base URLs; OpenAI GPT, `openai-compatible`, and Mistral all dispatch into [src/llm/openai.ts](src/llm/openai.ts).

API keys are stored per profile on `EnvironmentProfile.transcriptionConfig.apiKey` / `llmConfig.apiKey`. Two slots per profile, one for transcription and one for the LLM. No global by-family map; the desktop and mobile profiles each carry their own keys even when both use the same provider (deliberate: per-profile keys make per-function usage tracking easier). Persistence is in [src/secrets.ts](src/secrets.ts) using the key IDs `profile:desktop:transcription`, `profile:desktop:llm`, `profile:mobile:transcription`, `profile:mobile:llm`.

## Settings

`GlobalSettings` (defined in [src/types.ts](src/types.ts)) is the shape of `data.json`. Loading flow:

1. `plugin.loadData()` returns `Partial<GlobalSettings> | null`.
2. `mergeSettings(DEFAULT_SETTINGS, stored)` deep-merges, preferring stored values.
3. If `merged.templates.length === 0`, [src/settings/default-templates.ts](src/settings/default-templates.ts) seeds the 5 starter templates and sets `defaultTemplateId` if unset. This handles first launch *and* migrations from any pre-Phase-11 install with an empty templates array.
4. `hydrateSecrets()` reads keys from `secrets.json.nosync` and writes them into each profile's `transcriptionConfig.apiKey` / `llmConfig.apiKey`.

Saving flow strips secrets out of `data.json` and writes them to `secrets.json.nosync` instead (see [src/secrets.ts](src/secrets.ts)). Never persist API keys to `data.json`.

## Commands

Registered in [src/main.ts](src/main.ts):

- **`rewrite-plugin:open-modal`** ("Open"): opens the main modal with the last-used template selected.
- **`rewrite-plugin:quick-record`** ("Quick record"): starts a recording immediately with a floating mini-UI (no modal). Second press toggles to Stop. On unconfigured profile or capture-API unavailability, opens the modal instead. On post-capture pipeline error, opens the modal so the user can retry (LLM-stage failures leave the raw transcript on the clipboard).

Plus an `addRibbonIcon('mic', 'ReWrite', ...)` that opens the modal.

## Code style

Per [.editorconfig](.editorconfig): tabs (width 4), LF, UTF-8, final newline. Matches the existing source.

## Obsidian plugin conventions

[AGENTS.md](AGENTS.md) has the full Obsidian-specific playbook. The non-obvious rules that actually constrain implementation:

- **Never change `manifest.json`'s `id` after release.** It's `rewrite-plugin`. Locked.
- **Use `this.register*` helpers** (`registerEvent`, `registerDomEvent`, `registerInterval`) for anything that needs cleanup. Otherwise reload/unload leaks. The Quick Record floater is the one exception (a `document.body` div lifecycled by `QuickRecordController.cancel()`, which `onunload` calls).
- **Mobile compatibility**: avoid Node/Electron APIs unless `manifest.json` sets `isDesktopOnly: true`. It's `false`, and the spec's mobile profile depends on this.
- **Keep [src/main.ts](src/main.ts) minimal**: only plugin lifecycle, command registration, settings tab registration. Feature logic belongs in dedicated modules.
- **Defer heavy work**: no long tasks in `onload`. Providers/recorders lazy-init when first used.
- **Network policy**: provider calls go to user-configured endpoints with user-provided keys. No telemetry, no auto-update of plugin code, no `fetch`+`eval`.
- **Releases**: GitHub release tag must exactly match `manifest.json`'s `version` (no leading `v`). Attach `main.js`, `manifest.json`, `styles.css` as individual binary assets (not zipped).

## Gotchas

- **`requestUrl` multipart bodies are hand-built.** `requestUrl` does not accept `FormData`. [src/http.ts](src/http.ts) exports `buildMultipart(parts)` which produces a `Uint8Array` with a random boundary; transcription adapters (Whisper, Rev.ai) call into it. If you add a multipart-LLM provider, reuse this rather than reaching for `FormData`.
- **`requestUrl` uses `throw: false` + status check.** All adapters surface non-2xx as `ProviderError` with `status` and `body`, so users see provider-attributed errors instead of opaque network failures.
- **`safeStorage` is lazy-required inside a `Platform.isDesktop` guard** in [src/secrets.ts](src/secrets.ts). Importing `electron` at module top would crash on mobile load (it's marked `external` in esbuild). Any failure is treated as "encryption unavailable", which is also the mobile path.
- **No baked-in model defaults.** Both profiles ship with `model: ""`. The modal renders an inline setup card that blocks recording/paste until the active profile has a provider, model, key, and (for `openai-compatible`) base URL. If you add a provider, do not bake a default model string; surface it as placeholder hint text.
- **`openai-compatible` base URL asymmetry** (literal interpretation of the spec): transcription appends `/v1/audio/transcriptions` to a *root* URL (`http://localhost:8080`); LLM appends `/chat/completions` to a URL that *already includes* `/v1` (`http://localhost:11434/v1`). The settings UI hint text and setup card both guide users; do not "normalize" one to match the other.
- **Web Speech adapter throws "should not be called".** The pipeline short-circuits when `source.kind === 'webspeech'` and uses the transcript captured live by `src/webspeech.ts` during recording. The factory still has the case to keep the switch exhaustive. On mobile WKWebView (iOS) `SpeechRecognition` is undefined, so [src/platform.ts](src/platform.ts) exports `isWebSpeechAvailable()`; the modal/setup-card and Quick Record both check it before starting a Web Speech session.
- **`setHeading()` instead of manual `<h2>`** inside settings tabs. `obsidianmd/settings-tab/no-manual-html-headings` forbids manual headings. Same applies anywhere else inside a settings tab that needs a section header.
- **`window.confirm` is banned** by ESLint's `no-alert`. [src/settings/tab.ts](src/settings/tab.ts) ships a small in-file `ConfirmModal extends Modal` used for template deletion; reuse that pattern if another phase needs confirmation, don't reach for `window.confirm`.
- **Sentence-case lint covers brand and acronym lists** in [eslint.config.mts](eslint.config.mts). Adding a new provider, model family, or product name means adding it to `REWRITE_BRANDS` (or `REWRITE_ACRONYMS` for things like `LLM`). Dropdown option labels also pass through the rule; in [src/settings/tab.ts](src/settings/tab.ts) and [src/ui/setup-card.ts](src/ui/setup-card.ts), labels are iterated via `opt.label` (member access) to dodge the literal-string check.
- **Provider option arrays appear in both setup-card.ts and tab.ts.** Intentionally duplicated rather than extracted, per the "don't refactor beyond what the task requires" rule. If the lists drift, fix the user-visible inconsistency, not the duplication.
- **Settings tab re-renders the entire container on dropdown changes** that toggle conditional fields (provider, insertMode, activeProfileOverride). Text fields call `saveSettings()` on change but do not redraw, so focus is preserved while typing. Preserve this pattern when adding new conditional fields.
- **Default templates re-seed when `templates.length === 0`**, not via a `hasSeeded` flag. This is deliberate: it migrates pre-Phase-11 installs and gives a user who deleted everything a way back to a working state. Stable IDs (`tpl-default-...`) mean re-seed produces no duplicates.
- **Quick Record uses a custom floating div, not a `Notice`.** Obsidian `Notice` does not support real interactive buttons. The floater is a `position: fixed` div on `document.body`, owned by `QuickRecordController`, with `cancel()` wired into `onunload`.
- **`secrets.json.nosync` uses the `.nosync` suffix on purpose**: iCloud Drive natively skips any file or folder whose name ends in `.nosync`. The README documents per-tool sync exclusion for other tools.

## Local install for testing

Build, then place/symlink `main.js`, `manifest.json`, and `styles.css` into `<Vault>/.obsidian/plugins/rewrite-plugin/` and reload Obsidian (Settings, Community plugins).

## Never use em dashes in your own writing.

Do not use the em dash character in any prose, lists, code comments, or analysis you produce. Use commas, periods, parentheses, semicolons, or colons instead, whichever fits the sentence best. Exception: when directly quoting a source inside quotation marks, preserve em dashes exactly as they appear. Do not silently edit quoted text.

Why: Consistent formatting preference for original writing, while keeping quoted material faithful to the source.
