# ReWrite (Voice Notes) â€” release feature checklist

Manual pass to run in a **scratch** Obsidian vault against the artifact under test — for a release gate, the published `-alpha`/`-beta` prerelease assets installed into the vault (see `docs/RELEASING.md`, "The alpha/beta channel"); for mid-development iteration, a fresh local build via `npm run release:prep`. This is the source of truth for release verification; the old checklist in `obsidian-voice-notes-spec.md` is retired.

Runnable standalone (no Claude Code needed). For each item, do the action and record the outcome on its `Result:` line as PASS / FAIL / SKIP plus any notes. Scope the pass to what changed, but always run **Core** and the clean-load check.

Keep this file current: when a feature is added or changed, add or update its item here in the same change, the same way CLAUDE.md and the wiki are kept in sync.

---

## 0. Load

- [ ] Plugin loads with no errors in the Obsidian developer console (Ctrl/Cmd+Shift+I). Result: ____
- [ ] Ribbon mic icon is present; clicking it opens the main modal. Result: ____
- [ ] Settings tab opens and renders all sections without throwing. Result: ____

## 1. Core commands & entry points

- [ ] `Open` command opens the modal with the last-used template selected. Result: ____
- [ ] `Quick record (last used)` starts recording immediately with the floating mini-UI (no modal); pressing it again stops. Result: ____
- [ ] `Quick record (set template)` records with the template chosen in Settings; with no template set it shows a Notice and does not start. Result: ____
- [ ] `Process text with template` runs a template over the active editor's selection (or whole note if no selection); no editor active shows a Notice. Result: ____
- [ ] `Reprocess audio file with template` opens the audio-file picker, then the template picker, then runs. Result: ____
- [ ] Editor menu shows "ReWrite with template..."; and "Reprocess audio with template..." when the cursor sits in an `![[audio]]` embed. Result: ____
- [ ] File-explorer right-click on an audio file shows "Reprocess audio with template...". Result: ____

## 2. Main modal

- [ ] **Record** tab: mic permission prompts; timer and level indicator update; Stop closes the modal and runs the pipeline detached with a sticky Notice (Saving audio / Transcribing / Cleaning up / Inserting). Result: ____
- [ ] Record tab: while recording, tab bar / template select / destination controls are disabled; only Record/Stop is interactive (the isLocked regression guard). Result: ____
- [ ] "No audio detected" warning appears after ~3 s of silence (mute the mic to test). Result: ____
- [ ] **Paste** tab: submitted text reaches the LLM; output inserted per the template; inline progress + Retry on error; the submit button disables during a run. Result: ____
- [ ] **From note** tab: uses selection or whole note body; same in-modal progress. Result: ____
- [ ] **Destination** override: changing insert mode / folder / filename affects this run only; "Reset to template default" clears it; the template file on disk is unchanged. Result: ____
- [ ] **Context hint**: the `<details>` appears only for a template with `enableContextHint`; the typed hint reaches the LLM (visible in the result); resets on template change. Result: ____
- [ ] Setup card blocks Record/Paste when the active profile is unconfigured, with the right voice-vs-text messaging. Result: ____
- [ ] **Record in background** (desktop): the checkbox shows on the Record tab, persists across reopen; ticking it and pressing Record closes the modal and continues in the Quick Record floater carrying the template/destination/context; hidden on mobile. Result: ____

## 3. Templates

- [ ] **Populate** seeds the 10 defaults (General cleanup, Todo list, Daily note, Meeting notes, Meeting transcript, Idea capture, Lecture, Podcast, Guides, Book log) plus SharedCore.md; re-running skips existing ids (non-destructive). Result: ____
- [ ] **Update** reconciles edited defaults; writes `Template update report.md` beside the folder for anything it can't auto-merge; an already-current folder is a no-op. Result: ____
- [ ] **Load prior versions** drops earlier shipped prompt versions in as selectable templates (or reports "none yet" when history is empty). Result: ____
- [ ] Editing a template `.md` in the vault refreshes the picker (create/modify/delete/rename all tracked, debounced). Result: ____
- [ ] **Note properties**: a template with `noteProperties` writes the declared keys into the new note's frontmatter (newFile only). Result: ____
- [ ] **Note title** (`titleFromContent`): the LLM-generated title names the new file via `{{title}}` / whole-name; falls back to the static name when unusable. Result: ____
- [ ] `disableSharedCore: true` runs a template without the shared-core preface (and settings shows the warning line naming it). Result: ____
- [ ] **Diarization is per-invocation**: the modal shows an "Identify speakers" checkbox only on a capable provider (AssemblyAI/Deepgram/Rev.ai), defaulting to the template's `diarize` flag (on for Meeting transcript); it can be unticked per run; there is no "Identify speakers" toggle in Settings; a non-diarize template (e.g. Daily note) produces no `Speaker` labels. Result: ____
- [ ] **Manage built-in templates**: each row has a clearly-labelled Enabled switch (caption reads "Enabled" when on, "Disabled" when off) and a Tracked checkbox with its label to the LEFT of the box (reads "Tracked" when checked, "Untracked" when unchecked); turning Enabled off (confirm modal) removes the file and Populate/Update no longer re-add it; turning it back on restores it; unchecking Tracked writes `managed: false` and Update then leaves it untouched (reported as untracked). Result: ____

## 4. Transcription providers

- [ ] Each configured provider produces a transcript on the happy path (OpenAI/Whisper, Groq, AssemblyAI, Deepgram, Rev.ai, Mistral Voxtral, openai-compatible, whisper-local). Result: ____
- [ ] `listModels` populates a dropdown for the providers that support it (OpenAI/Groq/Mistral/Voxtral/Deepgram); Refresh works; Custom... toggles a text field. Result: ____
- [ ] Providers without listing (openai-compatible/AssemblyAI/Rev.ai) show a plain text field (with a docs link for AssemblyAI/Rev.ai). Result: ____
- [ ] Over-limit recording surfaces a friendly per-provider byte/duration error (validated after persist, so the saved file survives). Result: ____
- [ ] AssemblyAI / Rev.ai polling completes for a longer clip (duration-aware timeout, not a flat 60 s) and tolerates a transient blip. Result: ____

## 5. LLM providers

- [ ] Each configured LLM provider cleans up text (OpenAI, Anthropic, Gemini, Mistral, openai-compatible). Result: ____
- [ ] `listModels` populates the dropdown where supported (OpenAI/Groq/Mistral/Anthropic/Gemini). Result: ____
- [ ] "Maximum note length" over a model's output cap surfaces the friendly "reduce Maximum note length" error (Anthropic/OpenAI 400; Gemini MAX_TOKENS). Result: ____
- [ ] An OpenAI reasoning model (o-series / gpt-5) works (uses `max_completion_tokens`). Result: ____

## 6. Local whisper.cpp host (desktop)

- [ ] Start (settings button or command) spawns the server; status bar dot goes green; transcription via `whisper-local` works. Result: ____
- [ ] Stop stops it; status returns to stopped. Result: ____
- [ ] A non-loopback `--host` in Extra args is refused before spawn. Result: ____
- [ ] Restarting Obsidian adopts the orphaned server (status shows "adopted from previous session"); an externally-started server shows "external" and Stop is disabled. Result: ____
- [ ] Status-bar item is hidden on mobile / when the active profile isn't whisper-local. Result: ____
- [ ] **Start automatically**: with the toggle on and the profile using whisper-local, the server starts on Obsidian launch (a still-running one is adopted, not doubled). Result: ____
- [ ] **Stop when idle**: with a small minutes value set, the server stops after that idle time; it never stops mid-transcription or an externally-started server. Result: ____

## 7. Known nouns / assistant prompt (wake name)

- [ ] Known nouns file entries are preserved verbatim in output; frontmatter is not sent to the LLM. Result: ____
- [ ] Saying "<assistant name>, <directive>" mid-recording extracts an ad-hoc instruction (Notice confirms count) and the directive is honored. Result: ____
- [ ] Assistant prompt file edits take effect; a missing/empty file falls back to the default preface. Result: ____

## 8. Secrets & encryption

- [ ] Fresh install defaults to Obsidian secret storage when available; keys save and hydrate across reload. Result: ____
- [ ] Passphrase mode: create with the entropy gate + strength meter + Generate button; lock/unlock works; a pipeline run prompts unlock when locked. Result: ____
- [ ] Copy (inactive -> active, source kept) and Clear (wipe one method) show confirm modals + a count Notice. Result: ____
- [ ] Corrupting `secrets.json.nosync` (bad JSON) preserves it as `.corrupt` and warns before any overwrite. Result: ____

## 9. Settings tab

- [ ] Active-on-this-device profile shows the accent border + badge; the inactive profile's body is collapsed and its expand state survives dropdown redraws. Result: ____
- [ ] Provider / insertMode / activeProfileOverride dropdowns show and hide the right conditional fields; text fields keep focus while typing. Result: ____
- [ ] Shared core section shows the Enabled/Disabled badge matching whether SharedCore.md is present/non-empty. Result: ____
- [ ] Async buttons (Populate/Update, whisper Start/Stop, Lock) can't be double-fired. Result: ____

## 10. Insert pipeline

- [ ] `cursor` inserts at the cursor; falls back to `append` with no editor. Result: ____
- [ ] `append` appends to the active markdown file; falls back to `newFile` with none open. Result: ____
- [ ] `newFile` creates the file; `{{date}}` / `{{time}}` / `{{title}}` expand; collisions resolve per `newFileCollisionMode` (auto iterate vs prompt). Result: ____
- [ ] For an audio source, the `![[<path>]]` embed is prepended and frontmatter still lands at byte 0. Result: ____

## 11. Quick Record UI

- [ ] Floater shows timer, template button (popover), and Stop; the stop-hotkey hint shows the current binding (or nothing when unbound). Result: ____
- [ ] Template popover: opens, is keyboard-navigable (Arrow/Escape), dismisses on selection / outside click / when processing starts. Result: ____
- [ ] Cancel works both during capture and during post-capture processing (aborts the pipeline). Result: ____

## 12. Real-time transcription

- [ ] `Real-time transcription (start/stop)` requires a **Real-time provider** set (AssemblyAI/Deepgram, independent of the batch transcription provider; errors with a steer otherwise), its real-time key set, and an open Markdown note. Verify the batch provider and real-time provider can differ (e.g. batch Voxtral + real-time AssemblyAI). Result: ____
- [ ] Settings shows a self-contained **Real-time transcription** section: a Real-time provider dropdown (None + realtime-capable only, so **only AssemblyAI/Deepgram, NOT Voxtral**) that re-renders on change, plus key + adaptive model field when a provider is picked; the model field is a dropdown with Refresh for Deepgram and a text field for AssemblyAI; the key persists/hydrates across reload under its own secret. Result: ____
- [ ] AssemblyAI/Deepgram: starting shows the floating bar (dot + rolling interim text + Stop); spoken words appear at the cursor as finalized segments; interim text is never inserted. Result: ____
- [ ] **Voxtral real-time is NOT offered** (pulled: not WebView-reachable). Confirm it is absent from the Real-time provider dropdown. (The adapter stays on disk, unwired.) Result: ____
- [ ] Stop flushes the last segment and closes the connection; running the command again while active stops it. Result: ____

## 13. Auto-ingest folders

- [ ] Settings "Auto-ingest folders": Add opens the rule popup; the template dropdown lists only newFile templates; rules list with enable toggle / Edit / Delete. Result: ____
- [ ] `Process auto-ingest folders` processes each audio file in an enabled folder with that rule's template, one at a time, behind a sticky Notice with Cancel. Result: ____
- [ ] On success each recording is moved to the attachments location and its note's `![[embed]]` still resolves; a re-run does not reprocess it. Result: ____
- [ ] A file that fails stays in the ingest folder and is retried next run; the summary Notice reports processed/failed counts **and** a second sticky Notice lists the concrete failure reason per file (first 5, then "â€¦and N more"). Result: ____
- [ ] **Ingest folder == recordings/attachments folder** is caught UP FRONT: setting a rule's folder to the same folder recordings are stored in (either the ReWrite Attachments folder, or Obsidian's own attachment folder when ReWrite's is blank) skips the rule with a clear "this folder is also where recordings are stored; point the rule at a different folder" Notice BEFORE any note is created. Result: ____
- [ ] **Move-after-success failure**: if the note is created but the recording can't be moved out, the error says the note was created and to move/delete the source manually (so it isn't reprocessed). Result: ____

## 14. Mobile

- [ ] On mobile, whisper-local and other desktop-only options are absent from dropdowns. Result: ____
- [ ] Modals pin to the top so fields stay above the soft keyboard; Paste textarea is shorter (rows=4). Result: ____
- [ ] Record + Paste paths work on mobile. Result: ____
- [ ] While recording on mobile, a yellow "keep Obsidian in the foreground" caution shows in the Record tab and the Quick Record floater; it's absent on desktop and hidden once processing starts. Result: ____
- [ ] Auto-ingest and real-time transcription work on mobile (both are cross-platform). Result: ____

## 15. Misc

- [ ] Errors surface as provider-attributed Notices; no secret leaks into a Notice or log (query strings redacted). Result: ____
- [ ] Cancelling a run (modal / Quick Record) leaves the persisted audio file as the recovery path and writes nothing further. Result: ____
