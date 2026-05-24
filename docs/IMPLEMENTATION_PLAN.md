# ReWrite (Voice Notes): Implementation Plan

## Context

The repository is the unmodified Obsidian [sample-plugin](https://github.com/obsidianmd/obsidian-sample-plugin) scaffold. The real product is described in [obsidian-voice-notes-spec.md](../obsidian-voice-notes-spec.md): an Obsidian plugin that records or accepts pasted speech, transcribes it via a user-configured provider, cleans/structures it via an LLM, and inserts the result per a chosen template. The plugin must run on desktop and mobile, with auto-selected provider profiles.

This plan covers the full v1 implementation from the spec, with the following user-confirmed decisions:

- **Display name**: "ReWrite (Voice Notes)"; manifest `id`: `rewrite-plugin`; commands prefixed `ReWrite: …`.
- **HTTP transport**: Obsidian's `requestUrl` for every provider call (bypasses CORS in renderer and mobile).
- **No baked-in model defaults**: profiles ship with empty model strings; the modal blocks with an inline setup card until the active profile is configured.
- **Scope**: full v1 (6 transcription + 5 LLM providers, profiles, secrets, modal, both commands, 5 default templates, settings UI).

The spec was written without referencing CLAUDE.md/AGENTS.md, so several details conflict with the build and Obsidian conventions. Those discrepancies are listed below with the chosen resolution.

---

## Spec discrepancies (resolved before coding)

| # | Spec says | Issue | Resolution |
|---|---|---|---|
| 1 | `import { safeStorage } from 'electron'` at module top | `electron` is externalized in [esbuild.config.mjs](../esbuild.config.mjs); top-level import crashes on mobile load. | Lazy require inside `Platform.isDesktop` guard. Wrap in `try/catch`; treat any failure as "encryption unavailable". |
| 2 | `Buffer.from(value, 'base64')` in secrets code | [tsconfig.json](../tsconfig.json) `lib` is DOM-only, no Node types. | Use `atob`/`btoa` plus Obsidian's `arrayBufferToBase64`/`base64ToArrayBuffer`. Stay in browser primitives. |
| 3 | Raw `POST {baseUrl}/v1/...` examples imply `fetch` | Anthropic blocks browser CORS without a dangerous header; many providers will fail in mobile WebView too. | All adapters call Obsidian `requestUrl`. Multipart bodies (Whisper, Rev.ai) hand-built as `ArrayBuffer` with the proper `Content-Type: multipart/form-data; boundary=…`. |
| 4 | Default LLM model `claude-sonnet-4-20250514` | Spec value is stale; user requested no hard default. | Ship profile with `model: ""`. Modal shows an inline setup card if any required field is blank. Settings text field is free-text per spec UI rule, with placeholder hints like `claude-sonnet-4-5` / `gpt-4o-mini`. |
| 5 | `Record<ProviderID, string>` for global keys | `openai` ID is reused by both transcription and LLM (same key value), but `openai-compatible` is distinct config (different URL per profile). | Global keys keyed by *provider family* (`openai`, `anthropic`, `groq`, `assemblyai`, `deepgram`, `revai`, `gemini`, `mistral`). `openai-compatible` has no global key: base URL+key live on the profile only. |
| 6 | `secrets.json.nosync` path `voice-notes` | id is now `rewrite-plugin`. | All paths and README sync-exclusion examples use `.obsidian/plugins/rewrite-plugin/secrets.json.nosync`. |
| 7 | Mobile profile default = `webspeech` | Obsidian iOS uses WKWebView; `SpeechRecognition` is unavailable there. Spec only mentions a fallback Notice. | Keep `webspeech` as the mobile default *transcription provider* (spec is firm on this), but the inline modal blocker detects unavailability up front and points the user to Paste tab + alternate provider. README "Mobile Limitations" section is explicit. |
| 8 | `recordingFormat: 'webm' \| 'mp4'` | iOS/Safari only supports `mp4`; desktop Electron prefers `webm/opus`. A hard user choice can produce an unrecordable selection. | Setting becomes a *preference* ranked against `MediaRecorder.isTypeSupported()`. Implement `getBestMimeType(preference)` per the spec's Prior-Art notes: falls back through the candidate list and finally `''` (browser default). |
| 9 | `claude-sonnet-4-20250514` and other model strings throughout | The spec confuses provider config defaults with documentation. | Treat all model strings in the spec as *examples* in placeholder/help text only; never as runtime defaults. |
| 10 | Manifest "Voice Notes" | Rebranded. | Display name = "ReWrite (Voice Notes)"; settings tab header = "ReWrite"; commands prefixed `ReWrite:`; spec's `voice-notes:open-modal` id stays the same character string for stability (`rewrite:open-modal`, `rewrite:quick-record`): picked once at v1, never renamed. |
| 11 | "Keep modal open on error so the user can retry" but Quick Record has no modal | Errors during Quick Record have no UI surface to retry from. | Quick Record errors fall back to opening the modal pre-populated with last audio/transcript (held in memory only). If recording itself failed, surface a Notice and stop. |
| 12 | Insert mode `cursor` with no editor | Unspecified. | If no `MarkdownView` is active when `cursor` mode runs, fall back to `append` to the most-recently-edited markdown file; if none, fall back to `newFile` using a default name. Surfaced as a Notice. |

---

## Architecture overview

```
src/
├── main.ts                     # Lifecycle only: load settings, register commands + ribbon + settings tab
├── types.ts                    # Shared interfaces (ProviderID, EnvironmentProfile, NoteTemplate, etc.)
├── settings/
│   ├── index.ts                # GlobalSettings interface + DEFAULT_SETTINGS + (load|save)Settings helpers
│   ├── tab.ts                  # PluginSettingTab with all 6 sections, dynamic provider-field show/hide
│   └── templates-ui.ts         # Templates CRUD + drag-to-reorder (Sortable-free, native HTML5 DnD)
├── secrets.ts                  # safeStorage + plaintext fallback; ArrayBuffer/base64 in browser primitives
├── platform.ts                 # Platform detection + active-profile resolver + webspeech availability probe
├── recorder.ts                 # MediaRecorder state machine + getBestMimeType + 25MB size guard
├── webspeech.ts                # SpeechRecognition wrapper (returns final transcript on stop)
├── pipeline.ts                 # Orchestrator: transcribe → cleanup → insert
├── insert.ts                   # cursor / newFile / append helpers + {{date}}/{{time}} expansion
├── http.ts                     # requestUrl wrappers: jsonPost, jsonGet, multipartPost (hand-built boundary)
├── ui/
│   ├── modal.ts                # Main modal: template select + Record/Paste tabs + inline setup blocker
│   ├── setup-card.ts           # Inline blocker shown when active profile is unconfigured
│   ├── progress.ts             # "Transcribing…" / "Cleaning up…" labels + cancel
│   └── ribbon.ts               # Ribbon icon registration
├── transcription/
│   ├── index.ts                # interface TranscriptionProvider + factory(profile) → instance
│   ├── openai.ts               # OpenAI Whisper (also reused by openai-compatible + groq presets)
│   ├── assemblyai.ts           # upload → request → poll
│   ├── deepgram.ts             # single POST
│   ├── revai.ts                # submit → poll → fetch transcript
│   └── webspeech.ts            # adapter that just returns the live transcript captured by webspeech.ts
└── llm/
    ├── index.ts                # interface LLMProvider + factory
    ├── openai.ts               # /v1/chat/completions (reused by openai-compatible + mistral preset)
    ├── anthropic.ts            # /v1/messages with system + messages[]
    └── gemini.ts               # :generateContent with system_instruction + contents[]
```

`main.ts` stays under ~80 lines: settings load, command registration, ribbon, settings tab. All feature code lives in the modules above.

---

## Implementation phases

### Per-phase deliverables (applies to every phase below)

Every phase ends with the same two doc touches before it counts as done:

1. **Update [docs/claude-scratch/STATUS.md](claude-scratch/STATUS.md)**: bump the "Updated" date, flip the phase row to committed/uncommitted, list uncommitted files, and trim the "What's left" section. This is the live tracker, so a future Claude can resume without re-reading the world.
2. **Update [CLAUDE.md](../CLAUDE.md)** if the phase changed anything CLAUDE.md describes (architecture, commands, gotchas, conventions). Per CLAUDE.md's own Documentation Maintenance rule. Phase 13 is the dedicated full refresh; phases before it should at minimum keep the doc from going stale (e.g. drop a pointer to STATUS.md if "Project state" is now wrong).

Treat both as part of the phase, not follow-ups. The user has already had to remind once.

### Phase 1: Scaffold rename and types (foundations)

- [manifest.json](../manifest.json): `id` → `rewrite-plugin`, `name` → `ReWrite (Voice Notes)`, `version` → `0.1.0` (pre-release), `minAppVersion` → `1.4.0`, `description` → spec wording, drop `fundingUrl`/`authorUrl`/`author` Obsidian defaults, `isDesktopOnly: false`.
- Replace [src/main.ts](../src/main.ts) and [src/settings.ts](../src/settings.ts) with the lifecycle-only skeleton plus new file layout.
- Create `src/types.ts`: `TranscriptionProviderID`, `LLMProviderID`, `TranscriptionConfig`, `LLMConfig`, `EnvironmentProfile`, `NoteTemplate`, `InsertMode`, `GlobalSettings`.
- Add `styles.css` placeholder; ensure tabs/UI styles for modal land here (no styled-components, no CSS-in-JS).

### Phase 2: Settings storage + secrets

- `src/settings/index.ts`: `loadSettings`/`saveSettings` wrappers. Migration block tolerates missing keys (return DEFAULT merged with stored).
- `src/secrets.ts`: `saveKey(providerFamily, key)` / `loadKey(providerFamily)` / `deleteKey(...)`. Lazy-require electron's `safeStorage` only when `Platform.isDesktop` is true; cache the availability check. Base64 in/out via `btoa`/`atob` over UTF-8 bytes. File path: `${plugin.manifest.dir}/secrets.json.nosync`.
- Verify the file is created lazily: never write on `onload`.

### Phase 3: Provider abstractions + factories

- `src/transcription/index.ts` defines:
  ```ts
  interface TranscriptionProvider {
    transcribe(audio: Blob, config: TranscriptionConfig, signal?: AbortSignal): Promise<string>;
    requiresAudio: boolean; // false for webspeech, true otherwise
  }
  function createTranscriptionProvider(id: TranscriptionProviderID): TranscriptionProvider;
  ```
- `src/llm/index.ts` mirrors the shape for `LLMProvider.complete(systemPrompt, userMessage, config, signal?)`.
- Factories return shared instances per family (so OpenAI/`openai-compatible`/groq all dispatch into `openai.ts` with different baseURL + model).
- `src/http.ts` wraps `requestUrl`: surfaces non-2xx as `ProviderError` with status + body; JSON body helpers stringify and set `Content-Type`. `multipartPost(url, headers, parts)` builds a `Uint8Array` with a random boundary and computed `Content-Length`.

### Phase 4: Transcription adapters (one PR-sized commit per group)

1. `openai.ts`: single multipart POST, used by `openai`, `openai-compatible`, `groq`. Field `response_format: text` so the body is plain text.
2. `deepgram.ts`: raw audio body with `Content-Type` matching the recorded mime. Parse `results.channels[0].alternatives[0].transcript`.
3. `assemblyai.ts`: upload (octet-stream), POST `/transcript` JSON, poll GET with exponential backoff (1s → 2 → 4 → max 8s), abort at 60s with timeout error.
4. `revai.ts`: multipart submit, poll job, GET `/transcript` with `Accept: text/plain`. Same 60s ceiling.
5. `webspeech.ts` adapter: thin wrapper that pulls the transcript out of the active `webspeech.ts` session. `requiresAudio = false`.

### Phase 5: LLM adapters

1. `openai.ts`: `/v1/chat/completions`. Reused by `openai`, `openai-compatible`, `mistral`. Parse `choices[0].message.content`.
2. `anthropic.ts`: `/v1/messages` with `anthropic-version: 2023-06-01`. Parse `content[0].text`. Add `anthropic-dangerous-direct-browser-access: true` header defensively in case any user runs in an env where requestUrl behaves like fetch.
3. `gemini.ts`: `:generateContent`. Parse `candidates[0].content.parts[0].text`. Tolerate `safetyRatings` blocks: surface as a "blocked by safety filter" error.

### Phase 6: Recorder + Web Speech

- `recorder.ts`: state machine `idle → recording → paused → recording → stopped`. Guard every transition. Collect `dataavailable` chunks in an array; on stop, concatenate to one Blob and check size. >25MB → reject with size error and a Notice suggesting a shorter clip (v1 deferral of chunking per spec).
- `getBestMimeType(preference)`: ordered candidate list, returns first supported, falls back to `''`. Preference inflects ordering only (mp4 first if user picked mp4).
- `webspeech.ts`: wraps `window.SpeechRecognition || window.webkitSpeechRecognition`. `start()` returns a controller with `stop()` that resolves to final transcript. Detects unsupported environments and rejects synchronously.

### Phase 7: Pipeline + Insert

- `pipeline.ts`: `run({ source: 'audio' | 'paste' | 'webspeech', payload, template, profile, onStage })`. Stages: `transcribe` (skipped for paste; webspeech short-circuits with pre-captured transcript) → `cleanup` → `insert`. Each stage updates `onStage(label)` for the modal's progress UI. Errors at transcribe halt the pipeline; LLM errors copy the raw transcript to clipboard and surface a Notice.
- `insert.ts`:
  - `cursor`: `app.workspace.getActiveViewOfType(MarkdownView)?.editor.replaceSelection(text)`; if missing, fall back to `append`.
  - `newFile`: expand `{{date}}` → `moment().format('YYYY-MM-DD')`, `{{time}}` → `HHmmss`. Create via `app.vault.create(path, body)`; open via `app.workspace.openLinkText(path, '', true)`.
  - `append`: append to active note (or last-edited markdown), guaranteeing one trailing newline before the inserted block.

### Phase 8: Modal + setup card

- `ui/modal.ts`: top-of-modal template selector (`<select>` populated from settings.templates). Two tabs: Record / Paste. Record tab renders a big button + timer + pulsing dot; flips to Stop while recording. Paste tab is a textarea + "Clean Up" button.
- `ui/setup-card.ts`: shown above the tabs when the active profile is missing transcription provider, LLM provider, or any required field (key/model/baseURL). Card has a provider dropdown + model field + "Open settings" button. Saving the inline form persists and re-renders the modal.
- Keyboard nav: Tab order; Enter triggers the primary action of the active tab; Escape closes (but progress runs in background and posts a final Notice).
- Modal stays open on error per spec; "Retry" button re-runs the last pipeline step.

### Phase 9: Settings tab

`src/settings/tab.ts` renders six sections in order:
1. Active Profile: read-out + override dropdown.
2. Desktop Profile: provider dropdowns + provider-conditional fields. Fields auto show/hide based on selection (webspeech hides key field; `openai-compatible` reveals base URL field).
3. Mobile Profile: same layout.
4. Global API Keys: one password input per provider family. Label: "Shared across profiles unless overridden above."
5. Templates: list with edit/delete/reorder. Editor is a small inline form: name, prompt (textarea min 6 rows), insertMode select, newFileFolder + newFileNameTemplate (visible when insertMode = `newFile`).
6. Recording: format preference selector.

Drag-to-reorder uses native HTML5 DnD (no extra dep). Each row has a drag handle and `draggable: true`.

### Phase 10: Commands + ribbon

- `rewrite:open-modal` ("ReWrite: Open"): opens modal with last-used template selected.
- `rewrite:quick-record` ("ReWrite: Quick Record"): checks active profile is configured; if not, opens modal to setup card. Otherwise starts recording immediately with a floating mini-UI (small Notice with elapsed timer; click to stop). On stop, runs pipeline with default template.
- Ribbon icon registered via `addRibbonIcon('microphone', 'ReWrite', …)` opening the modal.

### Phase 11: Templates seed data

Ship the 5 default templates with prompt text drafted to spec intent (paraphrased here; actual text written in implementation):
- General Cleanup, Todo List, Daily Note, Meeting Notes, Idea Capture.
Loaded on first launch only (i.e. when `settings.templates.length === 0` after merge with defaults). Users can fully edit/remove afterward.

### Phase 12: README

Replace `README.md` per spec sections: install, sync-exclusion instructions for every listed sync tool (paths use `rewrite-plugin`), mobile limitations (iOS screen-off, Web Speech availability, secrets-not-encrypted-on-mobile), acknowledgements (Magic Mic, Scribe, sample-plugin), known limitations.

### Phase 13: CLAUDE.md update

Per CLAUDE.md's Documentation Maintenance rule, when implementation lands also update:
- Replace the "Project state" paragraph to reflect that the plugin is now in active development with the structure described above.
- Add a "Pipeline" section enumerating the transcribe → cleanup → insert stages and where each lives.
- Add a "Provider system" section pointing at `transcription/index.ts` and `llm/index.ts` factories.
- Add gotchas: requestUrl multipart trick, safeStorage lazy-require, no model defaults, webspeech mobile unavailability.

---

## Critical files

Create:
- `src/types.ts`
- `src/settings/index.ts`
- `src/settings/tab.ts`
- `src/settings/templates-ui.ts`
- `src/secrets.ts`
- `src/platform.ts`
- `src/recorder.ts`
- `src/webspeech.ts`
- `src/pipeline.ts`
- `src/insert.ts`
- `src/http.ts`
- `src/ui/modal.ts`
- `src/ui/setup-card.ts`
- `src/ui/progress.ts`
- `src/ui/ribbon.ts`
- `src/transcription/{index,openai,assemblyai,deepgram,revai,webspeech}.ts`
- `src/llm/{index,openai,anthropic,gemini}.ts`
- `README.md` (replace sample)

Modify:
- [manifest.json](../manifest.json): id/name/version/description/minAppVersion
- [src/main.ts](../src/main.ts): gut to lifecycle skeleton
- [src/settings.ts](../src/settings.ts): delete (logic moves under `src/settings/`)
- [CLAUDE.md](../CLAUDE.md): refresh "Project state" + add Pipeline / Provider system sections
- `styles.css`: modal styles

Keep:
- [esbuild.config.mjs](../esbuild.config.mjs): already correct
- [tsconfig.json](../tsconfig.json), [eslint.config.mts](../eslint.config.mts), [.editorconfig](../.editorconfig)
- [.github/workflows/lint.yml](../.github/workflows/lint.yml)
- [version-bump.mjs](../version-bump.mjs)

---

## Verification

No test runner is configured (CLAUDE.md). Verification is the spec's Testing Checklist plus the following manual procedure on each device class.

**Build + lint gate (CI parity):**
```
npm install
npm run build     # tsc -noEmit + esbuild production
npm run lint
```

**Local install (desktop):**
1. Symlink `main.js`, `manifest.json`, `styles.css` into `<TestVault>/.obsidian/plugins/rewrite-plugin/`.
2. Enable in Obsidian.
3. Walk the Testing Checklist (lines 454–476 of the spec): every checkbox manually verified.
4. Verify `secrets.json.nosync` exists, contains base64 blobs with `_encrypted: true`, and is unreadable when copied to a different desktop user account.

**Mobile smoke (Android + iOS Obsidian):**
- Profile auto-switches to Mobile.
- Paste tab → Anthropic happy path (with key entered on device).
- Record tab on Android: webspeech captures speech; on iOS: setup card surfaces "Web Speech unavailable; use Paste or pick another provider" and lets the user switch.
- `secrets.json.nosync` written with `_encrypted: false` on mobile.

**Smoke per provider:** at least one happy-path transcript per provider, validated against the response shape parser. AssemblyAI and Rev.ai also tested for the 60s timeout (point at a fake slow endpoint or a known long clip).

**Modal UX:** Tab navigation, Enter triggers primary action, error keeps modal open, Retry button re-runs the last failed stage.

**Insert modes:** all three produce correct placement; `{{date}}` and `{{time}}` expand in filenames.

**Edge cases:** missing key → Notice, no network → Notice, empty transcript → halts before LLM, oversize recording (>25MB) → halts with Notice.
