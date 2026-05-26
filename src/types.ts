export type TranscriptionProviderID =
	| 'openai'
	| 'openai-compatible'
	| 'groq'
	| 'assemblyai'
	| 'deepgram'
	| 'revai'
	| 'webspeech'
	| 'whisper-local';

export type LLMProviderID =
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
	assistantPrompt: string | null;
	knownNouns: KnownNoun[];
}

export interface EnvironmentProfile {
	name: string;
	transcriptionProvider: TranscriptionProviderID;
	transcriptionConfig: TranscriptionConfig;
	llmProvider: LLMProviderID;
	llmConfig: LLMConfig;
}

export type ActiveProfileOverride = 'auto' | 'desktop' | 'mobile';
export type ActiveProfileKind = 'desktop' | 'mobile';
export type RecordingFormatPreference = 'webm' | 'mp4';

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
}

export interface GlobalSettings {
	activeProfileOverride: ActiveProfileOverride;
	desktopProfile: EnvironmentProfile;
	mobileProfile: EnvironmentProfile;
	defaultTemplateId: string;
	lastUsedTemplateId: string;
	recordingFormat: RecordingFormatPreference;
	templatesFolderPath: string;
	attachmentsFolderPath: string;
	adHocInstructionsEnabled: boolean;
	assistantName: string;
	assistantPromptPath: string;
	knownNounsPath: string;
	modelCache: ModelCache;
	localWhisper: LocalWhisperSettings;
}
