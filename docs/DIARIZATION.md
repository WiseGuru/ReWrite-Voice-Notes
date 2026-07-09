# Speaker diarization

> Extracted from CLAUDE.md. Subject to the same maintenance rule: when you change diarization behavior, update this file in the same change, and keep the one-line summary in [CLAUDE.md](../CLAUDE.md) accurate.

Opt-in `Speaker X:` labels, chosen **per invocation** (there is no persisted profile setting). When on, the capable adapter embeds `Speaker X:` labels into the returned transcript string (the v1 shape from the diarization item in the [ROADMAP.md](ROADMAP.md) archive; the `transcribe(): Promise<string>` interface is unchanged, and cleanup/insert treat the labels as ordinary text). Capability is centralized in `transcriptionProviderSupportsDiarization(id)` ([src/transcription/index.ts](../src/transcription/index.ts)), true only for `assemblyai` / `deepgram` / `revai`. `TranscriptionConfig.diarize?: boolean` ([src/types.ts](../src/types.ts)) still carries the flag into the adapter, but it is set by the pipeline per run, not stored as a user preference.

Why per-invocation: a profile-wide "always diarize" setting wrongly labels notes where speaker turns are meaningless (a daily-note braindump becomes `Speaker A: ...`). Harmless but unclean, so diarization is now a deliberate per-run choice.

## The two inputs (template flag + modal toggle)

1. **Template flag** `NoteTemplate.diarize?: boolean` (frontmatter `diarize: true`): the template's default. The Meeting transcript default ships with it set.
2. **Modal toggle**: the main modal renders a per-run "Identify speakers" checkbox (`renderDiarizeToggle` in [src/ui/modal.ts](../src/ui/modal.ts)) whenever the active provider supports diarization. It defaults to the active template's flag, is reset when the template selector changes, and its value rides `PipelineParams.diarize` through every run path (Record tab, `startRecordingPipeline`, and the "Record in background" -> Quick Record handoff, cleared when the floater switches templates).

[src/pipeline.ts](../src/pipeline.ts) `collectTranscript` computes `effectiveDiarize = (template.diarize || params.diarize) && transcriptionProviderSupportsDiarization(profile.transcriptionProvider)` and builds `{ ...profile.transcriptionConfig, diarize: effectiveDiarize }` for the transcribe call, always setting the flag explicitly (a stale `diarize` in an older `data.json` cannot leak through). The profile config object is never mutated. On a non-capable provider the flag is a documented no-op, not an error. There is no settings-tab toggle; removing it was the point of this change.

## Per-adapter behavior

[src/transcription/assemblyai.ts](../src/transcription/assemblyai.ts) sets `speaker_labels: true` and formats the returned `utterances[]` (`Speaker A: ...`, native letter labels); [src/transcription/deepgram.ts](../src/transcription/deepgram.ts) adds `diarize=true` and groups per-word `speaker` indices via `formatDiarizedWords` (0-based bumped to `Speaker 1`); [src/transcription/revai.ts](../src/transcription/revai.ts) fetches the JSON transcript (`Accept: application/vnd.rev.transcript.v1.0+json`) instead of `text/plain` and rebuilds labels from `monologues[]` via `formatMonologues` (0-based bumped to `Speaker 1`). Each adapter falls back to its flat-text path when the labeled payload is missing, so toggling off is a clean no-op. Label survival through cleanup is handled by a clause in `DEFAULT_SHARED_CORE` ([src/shared-core.ts](../src/shared-core.ts)) telling the LLM to preserve `Speaker X:` prefixes; the Podcast default template already tolerates labeled and unlabeled input.
