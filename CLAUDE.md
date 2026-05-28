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
├── platform.ts                      # Active-profile resolver + MediaRecorder availability probe
├── secrets.ts                       # safeStorage (desktop) + plaintext fallback (mobile) for API keys
├── recorder.ts                      # MediaRecorder state machine + getBestMimeType (no size cap; per-provider limits live in transcription/limits.ts)
├── audio-transcode.ts               # WebAudio decode + resample to 16 kHz mono PCM WAV (shared by whisper-local and mistral-voxtral)
├── pipeline.ts                      # transcribe → cleanup → insert orchestrator
├── insert.ts                        # cursor/newFile/append + {{date}}/{{time}} expansion
├── whisper-host.ts                  # Spawns/stops a user-supplied whisper-server child process (desktop only)
├── templates-folder.ts              # Load templates from a vault folder + populate it with the 5 defaults
├── assistant-prompt.ts              # Load the ad-hoc-instructions assistant prompt from a vault Markdown file + populate default
├── known-nouns.ts                   # Load a vault Markdown file of known nouns + populate default + build the system-prompt section
├── audio-persist.ts                 # Write the recorded Blob to an attachments folder, return vault-relative path
├── wake-name.ts                     # Extract "<assistantName>, <directive>" instructions from a transcript
├── settings/
│   ├── index.ts                     # DEFAULT_SETTINGS, load/save, per-profile secret hydration
│   ├── tab.ts                       # PluginSettingTab: active profile, two profile sections, templates folder, recording
│   └── default-templates.ts         # The 5 default templates used by the populate button (General cleanup, Todo list, etc.)
├── ui/
│   ├── modal.ts                     # Main modal: template select + Record/Paste/From note tabs + setup-card injection
│   ├── setup-card.ts                # Inline blocker when active profile is unconfigured (voice vs text purpose)
│   ├── quick-record.ts              # QuickRecordController + floating mini-UI for the Quick Record command
│   ├── template-picker.ts           # Lightweight modal for picking a template (used by Process text command and editor menu)
│   ├── text-source.ts               # resolveActiveTextSource + runTextPipeline helpers for text-source flows
│   └── whisper-status-bar.ts        # Status-bar dot for whisper-host start/stop (desktop + whisper-local profile only)
├── transcription/
│   ├── index.ts                     # TranscriptionProvider interface + createTranscriptionProvider()
│   ├── limits.ts                    # Per-provider maxBytes/maxDurationMs + validateRecording (called from pipeline)
│   ├── openai.ts                    # Whisper-shape POST (also used by openai-compatible + groq)
│   ├── assemblyai.ts                # upload → submit → poll
│   ├── deepgram.ts                  # single POST
│   ├── revai.ts                     # submit → poll → fetch text
│   ├── mistral-voxtral.ts           # Mistral Voxtral STT (JSON response; always transcodes to WAV)
│   └── whisper-local.ts             # Thin shim that POSTs to the WhisperHost-managed local server
└── llm/
    ├── index.ts                     # LLMProvider interface + createLLMProvider()
    ├── openai.ts                    # /v1/chat/completions (also used by openai-compatible + mistral)
    ├── anthropic.ts                 # /v1/messages
    └── gemini.ts                    # :generateContent
```

## Pipeline

[src/pipeline.ts](src/pipeline.ts) runs four stages with `onStage` callbacks for UI:

1. **Persist audio** (`audio` source only): writes the raw `Blob` to the vault via [src/audio-persist.ts](src/audio-persist.ts) before transcription, so the user keeps the recording even if later stages fail. Path resolution: when `settings.attachmentsFolderPath` is set, the file goes under that folder with manual de-collision (`-1`, `-2`, ...); when empty, the path comes from `app.fileManager.getAvailablePathForAttachment(filename)`, which respects Obsidian's own attachments setting. Filename is `ReWrite-YYYY-MM-DD-HHmmss.<ext>` with the extension derived from the blob's mime type (`webm` / `m4a` / `ogg` / `wav` / `mp3`, default `webm`). Failure is non-fatal: a Notice fires and transcription proceeds. The resolved path is later prepended to the cleaned output as `![[<path>]]\n\n` before insertion.
2. **Transcribe**: `audio` → `createTranscriptionProvider(profile.transcriptionProvider).transcribe(blob, config)`. Skipped when the source is `paste` or `text` (input passes through). Just before dispatching, `validateRecording(blobSize, durationMs, providerId)` from [src/transcription/limits.ts](src/transcription/limits.ts) throws a friendly per-provider error if the recording exceeds the provider's documented byte or duration cap. Because validation runs after `persist-audio`, the user keeps the saved file and can switch providers + reprocess from the vault.
3. **Cleanup**: `createLLMProvider(profile.llmProvider).complete(systemPrompt, transcript, config)`. The system prompt is the template prompt, optionally augmented with an `## Ad-hoc instructions` block when the wake-name scan ([src/wake-name.ts](src/wake-name.ts)) extracts directives from the transcript, and a `## Known nouns` block when `plugin.knownNouns` is non-empty (see Assistant prompt and Known nouns sections below). On error, the (possibly stripped) transcript is copied to the clipboard before re-throwing, so the user keeps their words.
4. **Insert**: `src/insert.ts` routes to `cursor` / `newFile` / `append` per the template. `cursor` falls back to `append` when no editor is active; `append` falls back to `newFile` when no markdown file exists. `{{date}}` / `{{time}}` in filename templates expand via Obsidian's `moment`. The modal's per-invocation Destination control overrides `insertMode` / `newFileFolder` / `newFileNameTemplate` via `PipelineParams.destinationOverride`; the override is shallow-merged onto a copy of the template before the insert call, so the template file on disk is never mutated.

The pipeline accepts an `AbortSignal` (forwarded to providers) and is consumed by [src/ui/modal.ts](src/ui/modal.ts), [src/ui/quick-record.ts](src/ui/quick-record.ts), and [src/ui/text-source.ts](src/ui/text-source.ts) (the `runTextPipeline` helper for command + editor-menu entry points). Every caller passes the plugin itself as `host: PipelineHost`; `PipelineHost` is a narrow interface ({ `assistantPrompt`, `knownNouns` }) so `cleanupTranscript` can read the loaded vault content without importing `ReWritePlugin` (which would form a circular dep through the UI layer).

The `PipelineSource` union has three variants: `audio` (recorded blob, optional `sourcePath` for reprocess flows), `paste` (textarea input), `text` (input from an existing note via selection or whole body). Text-source flows skip transcription entirely and only require the LLM half of the profile. The `audio` variant's `sourcePath` is set by the reprocess flow ([src/ui/audio-source.ts](src/ui/audio-source.ts)) to point at an existing vault file; when present, the persist stage is skipped and that path is reused for the `![[<path>]]\n\n` prepend.

## Provider system

[src/transcription/index.ts](src/transcription/index.ts) and [src/llm/index.ts](src/llm/index.ts) each define a small interface plus a `create...Provider(id)` factory. Provider families share one adapter file where the API shapes match: OpenAI Whisper, `openai-compatible`, and Groq all dispatch into [src/transcription/openai.ts](src/transcription/openai.ts) with different base URLs; OpenAI GPT, `openai-compatible`, and Mistral all dispatch into [src/llm/openai.ts](src/llm/openai.ts). Mistral Voxtral does NOT share with `openai.ts` (see [src/transcription/mistral-voxtral.ts](src/transcription/mistral-voxtral.ts)) because Voxtral's response is JSON-only (no `response_format=text`) and it rejects WebM input (so the blob is always transcoded to 16 kHz mono WAV via [src/audio-transcode.ts](src/audio-transcode.ts)).

API keys are stored per profile on `EnvironmentProfile.transcriptionConfig.apiKey` / `llmConfig.apiKey`. Two slots per profile, one for transcription and one for the LLM. No global by-family map; the desktop and mobile profiles each carry their own keys even when both use the same provider (deliberate: per-profile keys make per-function usage tracking easier). Persistence is in [src/secrets.ts](src/secrets.ts) using the key IDs `profile:desktop:transcription`, `profile:desktop:llm`, `profile:mobile:transcription`, `profile:mobile:llm`.

Providers may optionally implement `listModels(config, signal)` returning a string array of model IDs the configured API key can access. Implemented by: OpenAI / Groq / Mistral (via `openai.ts` shared adapter), Mistral Voxtral (own adapter, filters Mistral's `/v1/models` catalog by ID substring `voxtral`), Anthropic, Gemini, Deepgram. Not implemented for `openai-compatible` (URL-specific, list-shape varies), AssemblyAI, Rev.ai. The settings tab caches results to `GlobalSettings.modelCache` per side and provider ID; the Refresh button in the model field triggers `listModels` and updates the cache. The text field next to the dropdown is always the canonical source of `profile.config.model` so users can type any string the dropdown doesn't expose.

## Local whisper.cpp host (desktop)

[src/whisper-host.ts](src/whisper-host.ts) exposes the `WhisperHost` class. The plugin instantiates one in `onload` and stops it in `onunload`. Configuration lives at `GlobalSettings.localWhisper = { binaryPath, modelPath, port, extraArgs }` — all user-supplied. No discovery, no PATH lookup, no auto-download.

`start()` validates the binary and model paths exist via `fs.existsSync`, probes the port via `net.createServer().listen(port)` to detect conflicts, spawns the user's whisper-server with `child_process.spawn`, captures stdout/stderr into a 1 MB ring buffer, then polls `net.createConnection` against the port every 250 ms for up to 5 s before declaring `'running'`. Any failure transitions status to `'crashed'` with the log tail surfaced in the error message. `stop()` sends SIGTERM, waits up to 3 s, then SIGKILL.

The `whisper-local` transcription provider ([src/transcription/whisper-local.ts](src/transcription/whisper-local.ts)) is a thin shim that POSTs to `http://127.0.0.1:<port>/inference` (whisper.cpp's native server route, not OpenAI's `/v1/audio/transcriptions`). Before sending, the recorded blob is transcoded to 16 kHz mono 16-bit PCM WAV via `transcodeToWavPcm` in [src/audio-transcode.ts](src/audio-transcode.ts) (Web Audio API: `AudioContext.decodeAudioData` → `OfflineAudioContext` for resample/downmix → hand-written RIFF header). whisper.cpp's server cannot decode WebM/Opus (the MediaRecorder default) without a custom ffmpeg-enabled build, so the transcode is mandatory. The same helper is reused by [src/transcription/mistral-voxtral.ts](src/transcription/mistral-voxtral.ts) (Voxtral also rejects WebM). If you add a third audio-uploading provider that needs WAV, import from `audio-transcode.ts` rather than duplicating the helpers. The shim grabs the host reference via `bindWhisperHost(host)` called from [src/main.ts](src/main.ts) on load. If the host status is anything other than `'running'`, the adapter throws a `ProviderError` with a "start it from settings" message; the pipeline surfaces that as a Notice. No API key is collected for this provider (no auth, no settings field).

Mobile compatibility: `WhisperHost` and the `whisper-local` option are guarded everywhere by `Platform.isDesktop`. Node modules (`child_process`, `net`, `fs`) are lazy-required inside the `Platform.isDesktop` branch, mirroring the [src/secrets.ts](src/secrets.ts) `getSafeStorage` pattern; on mobile the host is inert and the provider option is filtered out of dropdowns in [src/settings/tab.ts](src/settings/tab.ts) and [src/ui/setup-card.ts](src/ui/setup-card.ts).

## Settings

`GlobalSettings` (defined in [src/types.ts](src/types.ts)) is the shape of `data.json`. Loading flow:

1. `plugin.loadData()` returns `Partial<GlobalSettings> | null`.
2. `mergeSettings(DEFAULT_SETTINGS, stored)` deep-merges, preferring stored values.
3. `hydrateSecrets()` reads keys from `secrets.json.nosync` and writes them into each profile's `transcriptionConfig.apiKey` / `llmConfig.apiKey`.

Saving flow strips secrets out of `data.json` and writes them to `secrets.json.nosync` instead (see [src/secrets.ts](src/secrets.ts)). Never persist API keys to `data.json`.

## Secrets encryption

[src/secrets.ts](src/secrets.ts) supports three encryption modes for `secrets.json.nosync`, file-wide (not per-key):

- **`safeStorage`** — Electron's OS keychain (Keychain on macOS, DPAPI on Windows, libsecret/kwallet on Linux). Default when available. Each value is the base64 ciphertext of `safeStorage.encryptString`. Desktop only; chosen automatically on first run when `safeStorage.isEncryptionAvailable()` returns true. Backend name is surfaced via `safeStorage.getSelectedStorageBackend()`.
- **`passphrase`** — WebCrypto AES-GCM-256 with a key derived from a user-supplied passphrase via PBKDF2-SHA256, 600,000 iterations, 16-byte random salt (per-file). Each value is stored as `<iv-b64>.<ct-b64>` (12-byte random IV per value). A `verifier` field stores an encryption of `VERIFIER_PLAINTEXT` so unlock can validate the passphrase without trying to decrypt user keys. Works on every platform including mobile and Linux-without-keyring.
- **`plaintext`** — no encryption. Only used as the auto-fallback on first run when `safeStorage` isn't available; users must explicitly opt back into it after switching away.

File envelope (`SECRETS_VERSION = 2`):
```json
{ "version": 2, "mode": "passphrase",
  "kdf": { "iterations": 600000, "salt": "<b64>" },
  "verifier": "<iv-b64>.<ct-b64>",
  "keys": { "profile:desktop:transcription": "<iv-b64>.<ct-b64>", ... } }
```

The derived AES-GCM key for passphrase mode lives in module-level state (`unlockedKey`); it never touches disk. `lockSecrets()` forgets it. `unlockSecrets(plugin, passphrase)` derives a candidate key and decrypts the `verifier` to check correctness before caching.

`ReWritePlugin.encryptionStatus` (a snapshot of `{ mode, locked, safeStorageAvailable, safeStorageBackend }`) is loaded on `onload` and refreshed via `plugin.refreshEncryptionStatus()` after every mode change / unlock. UI code reads this synchronously.

When `mode === 'passphrase'` and not yet unlocked (`encryptionStatus.locked === true`):
- `loadAllKeys` / `loadKey` return empty strings (no error).
- `saveManyKeys` is a no-op (so calls to `saveSettings()` from unrelated UI changes do not clobber the on-disk encrypted values with empties).
- `saveKey` throws.
- All entry points ([src/ui/modal.ts](src/ui/modal.ts), [src/ui/quick-record.ts](src/ui/quick-record.ts), [src/ui/text-source.ts](src/ui/text-source.ts), [src/ui/audio-source.ts](src/ui/audio-source.ts)) check `plugin.encryptionStatus.locked` and call `plugin.promptUnlock()` instead of proceeding.
- The settings tab disables the API key input fields and shows a red "Unlock" banner at the top.

`changeEncryptionMode(plugin, newMode, newPassphrase?)` decrypts all keys with the current mode, switches the envelope, and re-encrypts them. Requires the current mode to be unlocked (if passphrase). For `passphrase` newMode, `newPassphrase` is required. `changePassphrase(plugin, newPassphrase)` is a thin wrapper that calls `changeEncryptionMode(plugin, 'passphrase', newPassphrase)`.

## Templates

Templates are Markdown files in a vault folder, not entries in `data.json`. The folder path lives on `GlobalSettings.templatesFolderPath` (default `ReWrite/Templates`). Each `.md` file in the folder is one template: YAML frontmatter holds `id`, `name`, `insertMode`, `newFileFolder`, `newFileNameTemplate`; the file body is the LLM prompt. Files are sorted by basename in the modal/picker so users can prefix names (`01-...`, `02-...`) to control order.

[src/templates-folder.ts](src/templates-folder.ts) exports `loadTemplatesFromFolder(app, folderPath)` and `populateDefaultTemplates(app, folderPath)`. The plugin keeps a cache on `plugin.templates: NoteTemplate[]`, refreshed in [src/main.ts](src/main.ts) on:
- `workspace.onLayoutReady` after `onload` (initial load, after the vault is ready)
- vault `create` / `modify` / `delete` events scoped to the templates folder via `isPathInTemplatesFolder`
- vault `rename` (checks both old and new path)
- the Templates folder path field changing in settings
- the populate button completing

Consumers ([src/main.ts](src/main.ts), [src/ui/modal.ts](src/ui/modal.ts), [src/ui/quick-record.ts](src/ui/quick-record.ts)) read `plugin.templates` directly, never `settings.templates` (there is no such field). The populate button is non-destructive: it skips any default template whose `id` already exists on disk, and skips path collisions. Frontmatter `id` is canonical for identity, so renaming a file does not break the `defaultTemplateId` / `lastUsedTemplateId` reference. The first-launch experience is empty templates plus a setup nudge in the modal; the user clicks Populate to get the defaults.

## Assistant prompt

The system-prompt preface inserted above extracted ad-hoc directives lives as a Markdown file in the vault, not a settings textarea. Path: `GlobalSettings.assistantPromptPath` (default `ReWrite/AssistantPrompt.md`). [src/assistant-prompt.ts](src/assistant-prompt.ts) exports `loadAssistantPromptFromFile(app, path)`, `populateDefaultAssistantPrompt(app, path)`, `isPathAssistantPrompt(path, configuredPath)`, and the `DEFAULT_ASSISTANT_PROMPT` constant used as the fallback when the file is missing or empty. The plugin caches the body on `plugin.assistantPrompt: string | null`, refreshed in [src/main.ts](src/main.ts) on the same triggers as templates (`workspace.onLayoutReady`, scoped vault `create`/`modify`/`delete`/`rename`, settings-path change, populate button). The file body is the prompt; frontmatter is currently ignored (the loader tolerates it for future extensions). [src/pipeline.ts](src/pipeline.ts) reads `params.host.assistantPrompt ?? DEFAULT_ASSISTANT_PROMPT` inside `cleanupTranscript`.

Branding note: the "AI name" / "Agent control prompt" labels in older builds are replaced by "Assistant name" / "Assistant prompt file" everywhere. The wake-name feature itself keeps the term "wake name" (it's the trigger word, not the persona). The setting key is `assistantName`; the persona is "the assistant".

## Known nouns

A vault Markdown file of proper nouns the LLM should preserve verbatim. Path: `GlobalSettings.knownNounsPath` (default `ReWrite/KnownNouns.md`). [src/known-nouns.ts](src/known-nouns.ts) exports `loadKnownNounsFromFile`, `populateDefaultKnownNouns`, `isPathKnownNouns`, and `buildKnownNounsSystemPromptSection(nouns)`. File format: YAML frontmatter for human-readable guidance (token-cost warning, format hint), Markdown body with one noun per line, optional `canonical: alt1, alt2` for misheard variants. Lines starting with `#` and blank lines are skipped. Frontmatter is parsed but NOT sent to the LLM in v1; future opt-in is possible but should not become the default. The default file body includes both the guidance frontmatter and two illustrative example nouns.

Cache: `plugin.knownNouns: KnownNoun[]` (default `[]`), refreshed on the same triggers as the assistant prompt. [src/pipeline.ts](src/pipeline.ts) appends the section returned by `buildKnownNounsSystemPromptSection(host.knownNouns)` to the system prompt when non-empty. Order in the assembled prompt: template prompt, then ad-hoc instructions (if any), then known nouns (if any).

## Commands

Registered in [src/main.ts](src/main.ts):

- **`rewrite-plugin:open-modal`** ("Open"): opens the main modal with the last-used template selected.
- **`rewrite-plugin:quick-record`** ("Quick record"): starts a recording immediately with a floating mini-UI (no modal). Second press toggles to Stop. On unconfigured profile or capture-API unavailability, opens the modal instead. On post-capture pipeline error, opens the modal so the user can retry (LLM-stage failures leave the raw transcript on the clipboard).
- **`rewrite-plugin:process-text`** ("Process text with template"): runs a template over the active editor's selection (or the whole note body if there's no selection). Opens a template quick-picker, then runs the pipeline in the background with progress shown via `Notice`. Gates on LLM-only configuration; opens the main modal's setup card when not configured. Bails with a Notice when no Markdown editor is active.
- **`rewrite-plugin:reprocess-audio`** ("Reprocess audio file with template"): reruns the pipeline over an audio file already in the vault. Opens an `AudioFilePickerModal` (`FuzzySuggestModal<TFile>` filtered to `AUDIO_EXTENSIONS` from [src/audio-persist.ts](src/audio-persist.ts)) then the template quick-picker, then calls `runAudioFilePipeline` in [src/ui/audio-source.ts](src/ui/audio-source.ts). The pipeline skips its `persist-audio` stage because the `audio` source variant carries a `sourcePath` (the existing vault path is reused for the `![[<path>]]\n\n` prepend). Gates on the full voice profile (`isProfileConfigured`).
- **`rewrite-plugin:start-whisper-host`** / **`rewrite-plugin:stop-whisper-host`**: start or stop the local whisper.cpp server. Both use `checkCallback` so the palette only shows them on desktop, when the active profile's transcription provider is `whisper-local` (start) or when the host is currently `running` / `starting` (stop). Errors surface via `Notice`. Same code paths as the settings-tab Start/Stop button.

Plus an editor-menu item "ReWrite with template..." registered via `workspace.on('editor-menu', ...)` (and a second "Reprocess audio with template..." item that appears only when the cursor sits inside an `![[<audio>]]` embed, resolved via `app.metadataCache.getFirstLinkpathDest`), a `workspace.on('file-menu', ...)` handler that adds "Reprocess audio with template..." for audio files in the file explorer, an `addRibbonIcon('mic', 'ReWrite', ...)` that opens the modal, and a status-bar item ([src/ui/whisper-status-bar.ts](src/ui/whisper-status-bar.ts)) showing the live whisper-host status. The status bar polls `whisperHost.status()` every 1 s via `registerInterval`, click toggles start/stop, and the item is hidden via the `rewrite-hidden` CSS class when on mobile or when the active profile is not `whisper-local`.

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
- **`safeStorage` is lazy-required inside a `Platform.isDesktop` guard** in [src/secrets.ts](src/secrets.ts). Importing `electron` at module top would crash on mobile load (it's marked `external` in esbuild). Any failure is treated as "encryption unavailable", which is also the mobile path and the Linux-without-keyring path. The settings tab surfaces the active backend via `safeStorage.getSelectedStorageBackend()` so users can see why it failed (e.g. `basic_text` is Chromium's last-resort backend and counts as unencrypted).
- **`saveManyKeys` is a silent no-op when locked.** When `mode === 'passphrase'` and `unlockedKey === null`, `saveManyKeys` does nothing. This is deliberate: unrelated `plugin.saveSettings()` calls (e.g. user changes a model dropdown) would otherwise persist empty `apiKey` values for every profile, wiping the on-disk encrypted bag. The UI prevents this by disabling key fields and gating all pipeline entry points on `encryptionStatus.locked`. `saveKey` (single-key write) still throws so callers can react.
- **No baked-in model defaults.** Both profiles ship with `model: ""`. The modal renders an inline setup card that blocks recording/paste until the active profile has a provider, model, key, and (for `openai-compatible`) base URL. If you add a provider, do not bake a default model string; surface it as placeholder hint text.
- **`openai-compatible` base URL asymmetry** (literal interpretation of the spec): transcription appends `/v1/audio/transcriptions` to a *root* URL (`http://localhost:8080`); LLM appends `/chat/completions` to a URL that *already includes* `/v1` (`http://localhost:11434/v1`). The settings UI hint text and setup card both guide users; do not "normalize" one to match the other.
- **`setHeading()` instead of manual `<h2>`** inside settings tabs. `obsidianmd/settings-tab/no-manual-html-headings` forbids manual headings. Same applies anywhere else inside a settings tab that needs a section header.
- **`window.confirm` is banned** by ESLint's `no-alert`. If a future phase needs an in-vault confirmation prompt, add a small `Modal` subclass rather than reaching for `window.confirm`.
- **Sentence-case lint covers brand and acronym lists** in [eslint.config.mts](eslint.config.mts). Adding a new provider, model family, or product name means adding it to `REWRITE_BRANDS` (or `REWRITE_ACRONYMS` for things like `LLM`). Dropdown option labels also pass through the rule; in [src/settings/tab.ts](src/settings/tab.ts) and [src/ui/setup-card.ts](src/ui/setup-card.ts), labels are iterated via `opt.label` (member access) to dodge the literal-string check.
- **Provider option arrays appear in both setup-card.ts and tab.ts.** Intentionally duplicated rather than extracted, per the "don't refactor beyond what the task requires" rule. If the lists drift, fix the user-visible inconsistency, not the duplication.
- **Settings tab re-renders the entire container on dropdown changes** that toggle conditional fields (provider, insertMode, activeProfileOverride). Text fields call `saveSettings()` on change but do not redraw, so focus is preserved while typing. Preserve this pattern when adding new conditional fields.
- **Profile sections wrap their settings in `.rewrite-profile-section`.** [src/settings/tab.ts](src/settings/tab.ts) `renderProfile()` creates a wrapper div per profile rather than rendering settings as direct children of `containerEl`. The active-on-this-device profile (per `detectActiveProfileKind`) gets `is-active-profile` (accent left border) and a `.rewrite-profile-active-badge` span inside the heading's `nameEl`. The inactive profile's body is wrapped in a `<details class="rewrite-profile-collapsed">` whose expand state lives on `ReWriteSettingTab.inactiveProfileExpanded` so it survives the full-container redraws triggered by dropdowns. New per-profile settings must take `body` as their parent (the wrapper or the `<details>`), not the original `parent` arg, or they will render outside the section's visual frame.
- **Both provider unions include `'none'`.** [src/types.ts](src/types.ts) `TranscriptionProviderID` and `LLMProviderID` carry a `'none'` member for users who only want one half of the pipeline. The factories in [src/transcription/index.ts](src/transcription/index.ts) and [src/llm/index.ts](src/llm/index.ts) return sentinel providers (transcription throws on `transcribe()`; LLM `complete()` returns the user message unchanged), but the pipeline never actually calls these because: (a) `collectTranscript` throws a friendlier error when `transcriptionProvider === 'none'` and `source.kind === 'audio'`; (b) `cleanupTranscript` short-circuits and returns the raw transcript when `llmProvider === 'none'` (this also skips wake-name extraction and known-nouns injection, since both only matter when an LLM consumes the system prompt). The settings tab + setup card hide model/baseUrl/apiKey fields for the `'none'` side; `isProfileConfigured` / `isProfileConfiguredForText` treat `'none'` as configured. The modal's Record tab, Quick Record, and the reprocess-audio command all gate on `transcriptionProvider === 'none'` with a "use Paste instead" hint.
- **Templates are vault files, not settings.** There is no `settings.templates` array. Consumers read `plugin.templates` (refreshed from disk). When you add a field to `NoteTemplate`, update [src/templates-folder.ts](src/templates-folder.ts) on both sides: `parseTemplateFile` reads it out of frontmatter (with a sensible default if missing), and `renderTemplateFile` writes it into the frontmatter the populate button emits. The populate button is non-destructive: it skips files whose `id` already exists, so re-running it tops up the folder without clobbering user edits.
- **Frontmatter parsing uses `parseYaml` from Obsidian, not the metadata cache.** The metadata cache is async and may not be populated for newly created files; reading content via `app.vault.read(file)`, splitting off the leading `---...---` block, and parsing it with `parseYaml` is synchronous-enough and works immediately after `app.vault.create`.
- **Quick Record uses a custom floating div, not a `Notice`.** Obsidian `Notice` does not support real interactive buttons. The floater is a `position: fixed` div on `document.body`, owned by `QuickRecordController`, with `cancel()` wired into `onunload`.
- **`secrets.json.nosync` uses the `.nosync` suffix on purpose**: iCloud Drive natively skips any file or folder whose name ends in `.nosync`. The README documents per-tool sync exclusion for other tools.
- **Per-provider recording limits live in [src/transcription/limits.ts](src/transcription/limits.ts), not the recorder.** [src/recorder.ts](src/recorder.ts) does not cap recordings at any size; `validateRecording(blobSize, durationMs, providerId)` runs in [src/pipeline.ts](src/pipeline.ts) between the `persist-audio` and `transcribe` stages, throwing a friendly provider-attributed error if the recording exceeds the documented byte or duration ceiling. Both modal and Quick Record thread the recorder's `durationMs` onto the `audio` pipeline source so the duration check has data; the reprocess flow ([src/ui/audio-source.ts](src/ui/audio-source.ts)) omits `durationMs` (no cheap way to measure an arbitrary vault file), so reprocess only triggers the byte check. Limits source: `openai`/`groq` 25 MB, `assemblyai` 5 GB/10 h, `deepgram` 2 GB, `revai` 2 GB/17 h, `mistral-voxtral` 1 GB/30 min, `openai-compatible`/`whisper-local`/`webspeech` no client-side cap.
- **WhisperHost lazy-requires Node modules** the same way [src/secrets.ts](src/secrets.ts) does for `safeStorage`. Importing `child_process` / `net` / `fs` at module top would crash on mobile load. The cached `nodeApiCache` is `null` on mobile, so any host method that needs it bails with a clear "desktop only" error.
- **WhisperHost has three ownership states.** `'spawned'` (this session's child handle is live; log capture works), `'adopted'` (port bound, PID sidecar matches a live PID — we started it in a previous session, no log capture), `'external'` (port bound but no sidecar match — someone else started it). Status enum gains `'external'` alongside `stopped`/`starting`/`running`/`crashed`; `running` means we own it (spawned OR adopted) and Stop works, `external` means we don't and Stop is disabled. `WhisperHost.snapshot()` returns `{ status, baseUrl, ownership, pid }` for UI consumers; `formatWhisperStatus(snap)` produces labels like "Running on http://... (adopted from previous session, pid 12345)." or "External whisper-server on http://... (not started by ReWrite).".
- **Transcription never checks `WhisperHost.status()`.** [src/transcription/whisper-local.ts](src/transcription/whisper-local.ts) just asks for `host.baseUrl()` and POSTs. The HTTP API doesn't care who owns the process — if the port is reachable, transcription works. `baseUrl()` returns the URL for both `'running'` and `'external'` states.
- **PID sidecar at `<plugin folder>/whisper-host.pid.json`** records `{ pid, port, binaryPath, startedAt }` once the server is ready. `stop()` and the child `exit` handler clear it. `WhisperHost.probe(config)` (called from `onload` and at the top of `start()`) reads the sidecar: if the port is reachable AND the sidecar PID is still alive AND the sidecar port matches the configured port, the host adopts it as `'running'` with ownership `'adopted'`. Otherwise (port bound, no sidecar match) the host transitions to `'external'`. Probe never disturbs state when we already hold a live spawned child. Uses `process.kill(pid, 0)` for liveness probing (added to the lazy `NodeAPI` cache alongside `cp`/`net`/`fs`).
- **Stop semantics depend on ownership.** Spawned: `child.kill()` via the live ChildProcess handle. Adopted: `process.kill(pid, signal)` since we only have the PID, then clear the sidecar. External: `stop()` throws "not started by ReWrite — stop it via OS tools." (the settings-tab button is disabled with a tooltip, the status-bar click shows a Notice, the `stop-whisper-host` command is hidden via `checkCallback`). This preserves the "never kill a process we didn't start" invariant — the sidecar is proof we started it.
- **`onunload` stops the whisper-host fire-and-forget.** `void this.whisperHost?.stop()` — Obsidian's `Plugin.onunload` signature is `() => void`, so we can't await. Stop() sends SIGTERM with a 3 s SIGKILL fallback, but the unload sequence may complete before that. Child processes do NOT auto-die with the parent on Linux (they reparent to init), on Windows (orphaned but still running), or reliably on macOS (SIGTERM may not land before Obsidian exits). The probe/adopt flow above is what closes this hole on next launch; don't try to make unload async.
- **Audio persistence runs before transcription**, not after, so the user keeps the recording even if transcription fails. [src/audio-persist.ts](src/audio-persist.ts) catches its own errors and emits a `Notice`; the pipeline always continues to the transcribe stage even when persistence throws. Cancel paths in [src/ui/modal.ts](src/ui/modal.ts) and [src/ui/quick-record.ts](src/ui/quick-record.ts) call `recorder.cancel()` before `runPipeline()`, so no orphan file is written on cancel. The `![[<path>]]` embed is prepended to the cleaned output unconditionally when an audio file was saved, regardless of insert mode. The reprocess flow ([src/ui/audio-source.ts](src/ui/audio-source.ts)) skips persistence by passing `sourcePath` on the `audio` source variant; the embed prepend still runs, reusing the existing vault path so reprocessed output links back to the original file.
- **Wake-name extraction is regex-only, off by default.** [src/wake-name.ts](src/wake-name.ts) requires `<assistantName>,` (vocative comma) to fire, captures up to the next sentence terminator or next name occurrence, and drops filler matches ("never mind", "scratch that", short tokens). It runs on ALL pipeline sources, including `paste` and `text`. The extracted instructions are appended to the LLM system prompt as a numbered `## Ad-hoc instructions` block, prefaced by `plugin.assistantPrompt` (loaded from `GlobalSettings.assistantPromptPath`); when the file is missing or empty, `DEFAULT_ASSISTANT_PROMPT` from [src/assistant-prompt.ts](src/assistant-prompt.ts) is used as the fallback so behavior is identical to the previous hardcoded textarea. Both the OpenAI and Anthropic adapters route this into the API's system slot. Whisper transcription homophones ("Scribner", "Scrivner") are not fuzzy-matched in v1; document the limitation if a user reports misses.
- **Known nouns frontmatter is NOT sent to the LLM.** The vault file at `GlobalSettings.knownNounsPath` uses YAML frontmatter purely for human-readable guidance (token-cost warning, format hint). Only the body lines are parsed via `loadKnownNounsFromFile` and injected by `buildKnownNounsSystemPromptSection`. If a future change opts frontmatter in, it should be a per-vault opt-in setting, not the default. The body parser treats `#` lines and blank lines as ignored; an entry can be either bare canonical (`Anthropic`) or canonical + misheard alternates (`Hoxhunt: hawks hunt, hocks hunt`).
- **PipelineHost decouples the pipeline from `ReWritePlugin`.** [src/pipeline.ts](src/pipeline.ts) reads `params.host.assistantPrompt` and `params.host.knownNouns` through the narrow `PipelineHost` interface in [src/types.ts](src/types.ts). The plugin class `implements PipelineHost`, but the pipeline never imports `ReWritePlugin` directly, which would create a cycle through the UI layer. New cross-cutting cleanup-stage inputs should extend `PipelineHost` rather than reach for the plugin object.
- **New-file collisions are resolved by `insert.ts`, not the caller.** `GlobalSettings.newFileCollisionMode` is `'auto'` (silently iterate `name-1.md`, `name-2.md`, ...) or `'prompt'` (open `RenamePromptModal` defaulted to the next free path; Cancel throws `Insert canceled: file already exists.`). Threaded through `InsertParams.collisionMode` from `pipeline.ts`. The path search uses `app.vault.getAbstractFileByPath` and caps at 1000 iterations. `nextFreePath` is local to [src/insert.ts](src/insert.ts); the equivalent `deCollide` in [src/audio-persist.ts](src/audio-persist.ts) is intentionally not shared — audio always auto-iterates regardless of the setting (the file is a side-effect users keep; the new-note path is the *target* the user named).
- **Destination override does not mutate the template object.** [src/ui/modal.ts](src/ui/modal.ts) renders a per-invocation Destination control (insertMode + conditional newFile fields) and threads the result through `PipelineParams.destinationOverride`. [src/pipeline.ts](src/pipeline.ts) shallow-merges the override onto a *copy* of the template via `applyDestinationOverride` before calling `insertOutput`; the cached template and the file on disk remain untouched. The override is ephemeral: it resets when the modal closes and when the template selector changes. Not exposed in Quick Record, `runTextPipeline`, or `runAudioFilePipeline` (no UI surface). The UI is a collapsible `<details>` whose `<summary>` reads `"Destination: Default (<description>)"` (no override) or `"Destination: Custom (<description>)"` (override set, forced open); expand state is tracked on `ReWriteModal.destinationExpanded` so it survives the full-container re-renders that fire when the inner insertMode dropdown changes. `describeDestination(mode, folder, name)` formats the description (e.g. `New file: ReWrite Notes/{{date}}-note`).
- **Quick Record floater holds its own popover.** The floater grew a third button between the timer and Stop that opens a popover-style template list ([src/ui/quick-record.ts](src/ui/quick-record.ts)). The popover is a child of the floater div, listens for outside-click via a capture-phase `document` listener and Escape via `document keydown`, and cleans up both listeners on dismiss. The popover dismisses on selection, Escape, outside click, and when `setBusy` runs (the pipeline is in flight). Selecting a template updates `controller.template` but does NOT update `lastUsedTemplateId`; that only happens after a successful completion, matching pre-popover behavior.
- **Whisper status bar polls `whisperHost.status()` every 1 s** via `registerInterval`. The host has no event emitter; both [src/settings/tab.ts](src/settings/tab.ts) (re-render on Start/Stop click) and [src/ui/whisper-status-bar.ts](src/ui/whisper-status-bar.ts) (interval poll) re-read the status synchronously. If you add a third consumer, poll the same way; do not bolt on an event system.
- **Mobile keyboard avoidance is CSS-only: pin our popups to the top.** Obsidian mobile (Capacitor) overlays the soft keyboard on top of the WebView without resizing the layout or visual viewport, so there is no reliable JS signal (`visualViewport` does not shrink, the `resize` event does not fire) to react to. The earlier JS helper (`installMobileKeyboardScrollFix`, which read `visualViewport` and shrank `.modal-container`) was a confirmed no-op on the failing cases and has been removed. The fix lives entirely in [styles.css](styles.css): under `.is-mobile`, our modal classes (`.rewrite-modal`, which covers the main + passphrase modals, and `.rewrite-rename-modal`) get `align-self: flex-start; margin-top: 8px; margin-bottom: auto; max-height: calc(100% - 16px)`, pinning the popup to the top of the flex container that centers modals. The keyboard opens from the bottom, so a top-anchored popup and its near-top input fields stay visible above it. Scoped to our classes so core Obsidian modals are untouched. The settings tab (a tall scrollable surface) was never affected and needs no rule: Chromium's native keyboard-aware focus-scroll handles it. If you add a new popup with a text field, give it one of these classes (or add its class to the selector) rather than reaching for a JS keyboard helper. Top-anchoring alone is not enough when something pushes the focused element low within a tall popup, so three companion tweaks keep the relevant element high: (a) `.is-mobile .rewrite-modal .modal-content` gets `padding-top: 8px` and `.is-mobile .rewrite-modal h2` gets `margin-top: 0` to reclaim the empty band Obsidian leaves above the title; (b) the Paste textarea renders at `rows = 4` on mobile (vs 10 on desktop, set in [src/ui/modal.ts](src/ui/modal.ts)) with the desktop 160px `min-height` floor dropped to 80px under `.is-mobile`, so its submit button stays above the keyboard; (c) the change-passphrase tips block is a `<details>` ([src/ui/passphrase-modal.ts](src/ui/passphrase-modal.ts) `renderPassphraseTips`) expanded by default on every platform (opt-out security guidance), but on mobile it auto-collapses (`collapseTipsOnMobile`) when a passphrase field receives focus, so it is seen on open yet stops pushing the fields into the keyboard once the user starts typing. The first field's `autofocus` is disabled on mobile (`autofocus = !Platform.isMobile`) so the auto-collapse fires on the user's tap rather than a premature programmatic focus.

## Local install for testing

Build, then place/symlink `main.js`, `manifest.json`, and `styles.css` into `<Vault>/.obsidian/plugins/rewrite-plugin/` and reload Obsidian (Settings, Community plugins).

## Never use em dashes in your own writing.

Do not use the em dash character in any prose, lists, code comments, or analysis you produce. Use commas, periods, parentheses, semicolons, or colons instead, whichever fits the sentence best. Exception: when directly quoting a source inside quotation marks, preserve em dashes exactly as they appear. Do not silently edit quoted text.

Why: Consistent formatting preference for original writing, while keeping quoted material faithful to the source.
