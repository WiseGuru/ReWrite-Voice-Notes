# ReWrite — Features To Add

Forward-looking backlog. Not committed to a release. Add items as they come up; move to a phase plan when picking one up.

## Open

### 1. LLM model field as a dropdown of available models

**Current state:** [src/settings/tab.ts:197-206](../src/settings/tab.ts#L197-L206) renders "LLM model" as a free-text input with a hint string from `llmModelHint()`. Same shape for "Transcription model" at [src/settings/tab.ts:136-145](../src/settings/tab.ts#L136-L145).

**Desired:** dropdown populated with models the configured provider actually exposes, instead of asking the user to type a model ID correctly.

**Open design questions (decide when picking this up):**

- **Source of the list.** Two options:
  1. *Live fetch* per provider. OpenAI has `GET /v1/models`, Anthropic has `GET /v1/models` (recent), Gemini has `GET /v1beta/models`, Mistral has `GET /v1/models`, Groq mirrors OpenAI, `openai-compatible` mirrors OpenAI. Pros: always current, surfaces user's actual entitlements. Cons: requires the API key to already be set before model selection, adds a network call to the settings tab, needs caching + a refresh button, needs graceful degradation when offline.
  2. *Static curated list* baked into each adapter, refreshed when we ship updates. Pros: works without a key, instant. Cons: stale list problem (this plugin's whole reason for existing is that model names move fast).
- **Recommended:** live fetch with on-disk cache (in `data.json`, per provider family, with timestamp), a "Refresh models" button next to the dropdown, and a "Custom..." escape hatch that falls back to free-text. Cache TTL ~7 days. If the fetch fails (no key, offline, 401), show the cached list if any, otherwise fall back to free-text with the current hint.
- **Same treatment for transcription model?** Yes, for the providers that expose it (OpenAI Whisper has limited models; AssemblyAI has tiers; Deepgram has many; Groq mirrors OpenAI; `openai-compatible` and `revai` should stay free-text since the namespace is user-controlled).
- **Per-profile vs. global cache?** Global per provider family — the model list doesn't depend on which profile you're configuring.

**Touch points:** [src/settings/tab.ts](../src/settings/tab.ts) (UI), per-provider adapter files under [src/llm/](../src/llm/) and [src/transcription/](../src/transcription/) (add `listModels(config)`), [src/types.ts](../src/types.ts) (cache shape on `GlobalSettings`).

---

### 2. Plugin-managed local whisper.cpp server (desktop)

**Goal:** let a desktop user run fully on-device transcription with whisper.cpp without ever opening a terminal during normal use. Plugin spawns the server, plugin tears it down, pipeline talks to it via the existing `openai-compatible` adapter under the hood.

**Scope: desktop only.** Mobile profile is unaffected and continues to use remote or `openai-compatible` providers. Guard everything with `Platform.isDesktop` and lazy-require Node modules inside the guard, the same pattern [src/secrets.ts](../src/secrets.ts) uses for `safeStorage`.

**Obsidian policy:** clean. Confirmed against [Obsidian's Developer policies](https://docs.obsidian.md/Developer+policies) and [Plugin guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines) on 2026-05-24: no explicit prohibition on child processes or launching user-supplied binaries. Standard transparency rules apply (disclose in README, no obfuscation).

**Binary + model location:** user-supplied absolute paths in settings, not a fixed location under `<vault>/.obsidian/plugins/rewrite-plugin/`. Two reasons: (a) people often keep binaries in `~/bin/` or a tools dir and would rather not duplicate, (b) large model files (150 MB-1.5 GB) inside `.obsidian/` would inflate vault sync (Obsidian Sync, Syncthing, iCloud, etc.). Plugin only reads paths, never copies or downloads.

**Staged delivery:**

#### Phase A (the "C" option) — on-demand, button-driven

User experience:

- New settings section "Local whisper.cpp server (desktop)". Fields:
  - Binary path (absolute, file picker + text input)
  - Model path (absolute, file picker + text input)
  - Port (default 8080, integer)
  - Extra args (optional, advanced)
- Start / Stop buttons in settings. Status indicator (stopped / starting / running / crashed).
- When running, transcription provider auto-resolves base URL to `http://127.0.0.1:<port>` if the user selects a new "Local whisper.cpp" transcription provider, *or* the user can still point `openai-compatible` at it manually (no special-casing in pipeline).

Build:

- New module `src/whisper-host.ts`: `start()`, `stop()`, `status()`, `onLog(cb)`. Uses lazy-required `child_process.spawn`, `net` (port-in-use probe), `fs` (existence checks).
- Health check after spawn: poll `GET /` or `GET /v1/models` on the port for up to ~5s before declaring ready.
- Orphan handling on startup: if a previous Obsidian crash left a process bound to the configured port, surface that in status rather than silently failing or killing an unrelated process.
- Cross-platform: handle `.exe` suffix on Windows, `chmod +x` is the user's problem (document it).
- Capture stdout/stderr, ring-buffer to ~1 MB, show in a "View log" disclosure inside settings.
- Stop on plugin unload regardless of how the server was started.

#### Phase B — auto-start lifecycle

Once Phase A is solid:

- Add "Start automatically when Obsidian opens" toggle (default off).
- Add "Stop when idle for N minutes" toggle (default off; useful for the large-v3 user who doesn't want 1.5 GB resident all day).
- README updates: setup walkthrough with binary + model download links, troubleshooting (port in use, antivirus blocking, model load failure).

**Touch points:** [src/main.ts](../src/main.ts) (lifecycle hook for stop-on-unload only), new `src/whisper-host.ts`, [src/settings/tab.ts](../src/settings/tab.ts) (new section), [src/types.ts](../src/types.ts) (settings shape), [src/platform.ts](../src/platform.ts) (capability probe for `Platform.isDesktop` + `FileSystemAdapter`), [README.md](../README.md) (new section + disclosure of process-spawn behavior).

**Risks / things to watch:**

- Process supervision has long-tail bugs (zombies, orphans, signal handling differences across platforms). Phase A's button-driven model is forgiving; Phase B's auto-lifecycle is where these bite.
- Antivirus may quarantine `whisper-server.exe` on Windows on first run. Document it; don't try to work around it.
- The plugin must never spawn anything the user didn't explicitly configure. No discovery, no PATH lookup, no "auto-download." Path is supplied → spawn that exact file.

---

### 3. Act on existing text in a note

**Goal:** apply a ReWrite template to text that's already in a markdown note, no recording involved. Use case: you used a separate STT app (or just typed) to get a wall of text into a note, now you want ReWrite to turn it into a daily note, a todo list, a summary, etc.

This is the same pipeline minus the transcribe stage. [src/pipeline.ts](../src/pipeline.ts) already short-circuits transcription for `source.kind === 'paste'` and `source.kind === 'webspeech'`; a new `source.kind === 'text'` slots in identically.

**Entry points (three, mirroring how voice has three):**

1. **Command palette: `rewrite-plugin:process-text` ("Process text with template").** Picks template, then runs on the editor's current selection if there is one, otherwise the whole note body. Bails with a Notice if no markdown editor is active.
2. **Editor context menu item: "ReWrite with template..."** Registered via `this.registerEvent(this.app.workspace.on('editor-menu', ...))`. Opens a template quick-picker (a small modal listing templates by name). Operates on selection if present, otherwise whole note.
3. **New tab in the existing modal: "From note".** Joins the existing "Record" and "Paste" tabs in [src/ui/modal.ts](../src/ui/modal.ts). Shows a preview of what will be processed ("Selection: 247 chars" or "Whole note: 1,832 chars"), template dropdown, Run button. Reachable via the ribbon icon and the existing `open-modal` command, so the feature is discoverable without anyone reading docs.

**Source resolution:**

- If an editor selection is non-empty → use selection.
- Else if the active leaf is a markdown view → use full note body.
- Else → Notice "Open a markdown note or select text to use this command." Bail.

**Output / insert behavior:**

- Honors the template's `insertMode` (cursor / newFile / append), same as voice. If the template says "create new file in Daily/", that's where the cleaned output goes regardless of where the source text came from. Consistent mental model: templates own *where output lives*.
- The source text is **not modified by default**. Output goes per template; user manually deletes the source if they want. Reason: silently mutating the source on every invocation is destructive and surprising.
- One exception worth considering: a per-invocation "Replace source after processing" checkbox in the modal/quick-picker (defaults off). Not a template setting because it's about the source, not the output. **Open question:** ship without this in v1 of the feature, add only if users actually ask. The default-off "Keep both" behavior is safer.

**Pipeline change:**

- New source variant in [src/pipeline.ts](../src/pipeline.ts): `{ kind: 'text', text: string }`. Skips transcribe stage exactly like `paste` does. Cleanup + insert run unchanged.
- The LLM-error clipboard fallback (currently copies the raw transcript when cleanup fails) still applies: copies the source text so the user doesn't lose context if the LLM call dies.
- `AbortSignal` plumbed through as today.

**Setup-card / config gating:**

- The "From note" tab and the new commands only need the LLM provider configured, not transcription. Setup card logic in [src/ui/setup-card.ts](../src/ui/setup-card.ts) currently blocks on *both* being configured. Either: split the gating per entry point (cleaner) or: only block on LLM for text-source entries (simpler). Pick when implementing.

**Touch points:** [src/pipeline.ts](../src/pipeline.ts) (add `text` source variant), [src/main.ts](../src/main.ts) (register new command + editor-menu event), [src/ui/modal.ts](../src/ui/modal.ts) (add "From note" tab), new file `src/ui/template-picker.ts` for the quick-picker modal used by the command + context menu, [src/ui/setup-card.ts](../src/ui/setup-card.ts) (relax gating for text-source flow), [src/types.ts](../src/types.ts) (extend source union).

**Out of scope (for this feature):**

- Per-template "this template only operates on text" / "this template only operates on voice" gating. All templates work with both source types in v1; if a user creates a template whose prompt only makes sense for raw transcripts, that's on them.
- Multi-select / multi-note batch processing. One source at a time.

---

## Done

### Collapse API key settings: per-profile only, hide rarely-changed fields under "Advanced"

Removed the "Global API keys" section and the by-family `apiKeys` map. Each profile now owns its own transcription and LLM keys directly on `transcriptionConfig.apiKey` / `llmConfig.apiKey`. The per-profile fields are no longer framed as "overrides"; they're the only slot. "Transcription language" and "LLM max tokens" moved into a per-profile `<details>` "Advanced" disclosure. The resolver functions (`resolveTranscriptionApiKey`, `resolveLLMApiKey`) and family helpers (`transcriptionProviderFamily`, `llmProviderFamily`) are gone, along with the `ProviderFamily` type. `secrets.json.nosync` now only contains `profile:{kind}:{side}` IDs.
