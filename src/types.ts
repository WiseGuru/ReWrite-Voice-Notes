export type TranscriptionProviderID =
	| 'none'
	| 'openai'
	| 'openai-compatible'
	| 'groq'
	| 'assemblyai'
	| 'deepgram'
	| 'revai'
	| 'mistral-voxtral'
	| 'whisper-local';

export type LLMProviderID =
	| 'none'
	| 'anthropic'
	| 'openai'
	| 'openai-compatible'
	| 'gemini'
	| 'mistral';

export interface TranscriptionConfig {
	apiKey: string;
	baseUrl: string;
	model: string;
	language: string;
	// Internal pipeline->adapter transport for speaker diarization. Set per
	// invocation by the pipeline (from the template's `diarize` flag OR the modal's
	// per-run toggle), NOT a persisted user setting. Only honored by capable
	// providers (assemblyai, deepgram, revai); when on, the adapter embeds
	// `Speaker X:` labels into the returned transcript string.
	diarize?: boolean;
}

export interface LLMConfig {
	apiKey: string;
	baseUrl: string;
	model: string;
	maxTokens: number;
}

export type InsertMode = 'cursor' | 'newFile' | 'append';

export interface NoteTemplate {
	id: string;
	name: string;
	prompt: string;
	insertMode: InsertMode;
	newFileFolder: string;
	newFileNameTemplate: string;
	// When true, the shared core preface is NOT prepended to this template's
	// prompt. Absent/false means the shared core is used (when one is loaded).
	disableSharedCore?: boolean;
	// When true, the modal / reprocess picker surfaces an optional free-text
	// "Context" field for this template (speakers, setting, subject). Opt-in:
	// absent/false means the field is hidden. NOTE the polarity is the reverse
	// of disableSharedCore (positive opt-in, not negative opt-out).
	enableContextHint?: boolean;
	// When true, this template defaults speaker diarization ON (e.g. Meeting
	// transcript). It seeds the modal's per-invocation "Identify speakers" toggle,
	// which the user can still override for a single run. Only effective on
	// diarization-capable providers (assemblyai/deepgram/revai); a no-op on the
	// rest. Absent/false means the toggle defaults off. There is no profile-wide
	// diarization setting anymore.
	diarize?: boolean;
	// When true, the LLM generates this note's title (filename) from the content and
	// any provided context, returned via a reserved `noteTitle` key in the same leading
	// yaml block as noteProperties. Consumed by insertNewFile only; never written to
	// frontmatter. Positive opt-in: absent/false uses the static newFileNameTemplate.
	titleFromContent?: boolean;
	// Frontmatter properties this template asks the LLM to fill from the content.
	// Authored in template frontmatter as a YAML map (key = property name, value =
	// instruction). Parsed into an ordered array (order drives both the prompt and
	// the write order). Applied only for insertMode 'newFile'.
	noteProperties?: NotePropertySpec[];
	// Tri-state ownership marker for built-in-derived files. `true` (written by
	// Populate/Update on the files they create or reconcile) means the file is
	// plugin-managed and Update may reconcile it against the current built-in.
	// `false` means the user untracked it: Update must never touch it again.
	// `undefined` (key absent/empty, e.g. files created before this flag existed)
	// is treated as managed when the id matches a built-in, preserving the old
	// behavior. Ignored entirely for ids not in the default set.
	managed?: boolean;
}

export interface NotePropertySpec {
	name: string;
	instruction: string;
}

export interface DestinationOverride {
	insertMode?: InsertMode;
	newFileFolder?: string;
	newFileNameTemplate?: string;
}

export interface KnownNoun {
	canonical: string;
	alternates: string[];
}

export interface PipelineHost {
	sharedCore: string | null;
	assistantPrompt: string | null;
	knownNouns: KnownNoun[];
}

export interface EnvironmentProfile {
	name: string;
	transcriptionProvider: TranscriptionProviderID;
	transcriptionConfig: TranscriptionConfig;
	llmProvider: LLMProviderID;
	llmConfig: LLMConfig;
	// Real-time (streaming) transcription is configured entirely independently of batch
	// transcription: its own provider, key, and model. A user can run e.g. Voxtral for batch,
	// AssemblyAI for realtime, and Anthropic for cleanup. `realtimeProvider` is 'none' (off)
	// or a realtime-capable provider (assemblyai/deepgram, per
	// transcriptionProviderSupportsRealtime). `realtimeConfig` holds its key + model (reuses
	// the TranscriptionConfig shape; `language`/`diarize` unused). Realtime models often
	// differ from batch (e.g. a distinct streaming model id), which is why this is separate
	// rather than reusing transcriptionProvider/transcriptionConfig.
	realtimeProvider: TranscriptionProviderID;
	realtimeConfig: TranscriptionConfig;
}

export type ActiveProfileOverride = 'auto' | 'desktop' | 'mobile';
export type ActiveProfileKind = 'desktop' | 'mobile';
export type RecordingFormatPreference = 'webm' | 'mp4';
export type NewFileCollisionMode = 'auto' | 'prompt';

export interface ModelCacheEntry {
	ids: string[];
	fetchedAt: number;
}

export interface ModelCache {
	transcription: Partial<Record<TranscriptionProviderID, ModelCacheEntry>>;
	llm: Partial<Record<LLMProviderID, ModelCacheEntry>>;
}

export interface LocalWhisperSettings {
	binaryPath: string;
	modelPath: string;
	port: number;
	extraArgs: string;
	// Phase B lifecycle knobs. autoStart spawns the server once the workspace is
	// ready (desktop + whisper-local profile only). idleStopMinutes > 0 stops a
	// ReWrite-owned (spawned/adopted, never external) server after that many
	// minutes without a transcription; 0 disables idle stop.
	autoStart: boolean;
	idleStopMinutes: number;
}

// One auto-ingest rule: a vault folder scanned on demand by the
// process-ingest-folders command, each audio file run through the pipeline with
// the preassigned template (newFile-mode only), then moved to the attachments
// location on success (move-on-success is the dedupe; failures stay put).
export interface IngestRule {
	folderPath: string;
	templateId: string;
	enabled: boolean;
}

export interface GlobalSettings {
	activeProfileOverride: ActiveProfileOverride;
	desktopProfile: EnvironmentProfile;
	mobileProfile: EnvironmentProfile;
	defaultTemplateId: string;
	lastUsedTemplateId: string;
	quickRecordTemplateId: string;
	recordingFormat: RecordingFormatPreference;
	templatesFolderPath: string;
	sharedCorePath: string;
	attachmentsFolderPath: string;
	newFileCollisionMode: NewFileCollisionMode;
	adHocInstructionsEnabled: boolean;
	assistantName: string;
	assistantPromptPath: string;
	knownNounsPath: string;
	modelCache: ModelCache;
	localWhisper: LocalWhisperSettings;
	// When true (desktop only), the main modal's Record button hands capture off to
	// the Quick Record floating UI (carrying the modal's template, destination
	// override, and context hint) so Obsidian stays usable while recording.
	recordInBackground: boolean;
	// Built-in default templates the user disabled: Populate and Update never
	// (re)create these ids. Keyed by frontmatter id (canonical; survives renames).
	disabledDefaultTemplateIds: string[];
	// Auto-ingest folder rules for the process-ingest-folders command.
	ingestRules: IngestRule[];
}
