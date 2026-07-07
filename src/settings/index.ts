import { Plugin } from 'obsidian';
import {
	ActiveProfileKind,
	ActiveProfileOverride,
	EnvironmentProfile,
	GlobalSettings,
	LLMConfig,
	LLMProviderID,
	LocalWhisperSettings,
	NewFileCollisionMode,
	RecordingFormatPreference,
	TranscriptionConfig,
	TranscriptionProviderID,
} from '../types';
import { loadAllKeys, saveManyKeys } from '../secrets';

// Enum/scalar values `mergeSettings`/`mergeProfile` accept from a stored data.json. A corrupt or
// hand-edited file could carry anything for these fields (spreading a non-object partial field
// over a nested config, e.g., would spread a string's characters into it), so every value read
// from `partial` is checked against this allowlist before use; anything else falls back to base.
const TRANSCRIPTION_PROVIDER_IDS: readonly TranscriptionProviderID[] = [
	'none', 'openai', 'openai-compatible', 'groq', 'assemblyai', 'deepgram', 'revai', 'mistral-voxtral', 'whisper-local',
];
const LLM_PROVIDER_IDS: readonly LLMProviderID[] = ['none', 'anthropic', 'openai', 'openai-compatible', 'gemini', 'mistral'];
const ACTIVE_PROFILE_OVERRIDES: readonly ActiveProfileOverride[] = ['auto', 'desktop', 'mobile'];
const RECORDING_FORMATS: readonly RecordingFormatPreference[] = ['webm', 'mp4'];
const NEW_FILE_COLLISION_MODES: readonly NewFileCollisionMode[] = ['auto', 'prompt'];

function pickEnum<T extends string>(valid: readonly T[], value: unknown, fallback: T): T {
	return typeof value === 'string' && (valid as readonly string[]).includes(value) ? (value as T) : fallback;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const EMPTY_TRANSCRIPTION_CONFIG: TranscriptionConfig = {
	apiKey: '',
	baseUrl: '',
	model: '',
	language: '',
};

const EMPTY_LLM_CONFIG: LLMConfig = {
	apiKey: '',
	baseUrl: '',
	model: '',
	maxTokens: 2560,
};

const DESKTOP_DEFAULT_PROFILE: EnvironmentProfile = {
	name: 'Desktop',
	transcriptionProvider: 'openai',
	transcriptionConfig: { ...EMPTY_TRANSCRIPTION_CONFIG },
	llmProvider: 'anthropic',
	llmConfig: { ...EMPTY_LLM_CONFIG },
};

const MOBILE_DEFAULT_PROFILE: EnvironmentProfile = {
	name: 'Mobile',
	transcriptionProvider: 'openai',
	transcriptionConfig: { ...EMPTY_TRANSCRIPTION_CONFIG },
	llmProvider: 'anthropic',
	llmConfig: { ...EMPTY_LLM_CONFIG },
};

const DEFAULT_LOCAL_WHISPER: LocalWhisperSettings = {
	binaryPath: '',
	modelPath: '',
	port: 8080,
	extraArgs: '',
};

export const DEFAULT_SETTINGS: GlobalSettings = {
	activeProfileOverride: 'auto',
	desktopProfile: DESKTOP_DEFAULT_PROFILE,
	mobileProfile: MOBILE_DEFAULT_PROFILE,
	defaultTemplateId: '',
	lastUsedTemplateId: '',
	quickRecordTemplateId: '',
	recordingFormat: 'webm',
	templatesFolderPath: 'ReWrite/Templates',
	sharedCorePath: 'ReWrite/SharedCore.md',
	attachmentsFolderPath: '',
	newFileCollisionMode: 'auto',
	adHocInstructionsEnabled: false,
	assistantName: 'Scrivener',
	assistantPromptPath: 'ReWrite/AssistantPrompt.md',
	knownNounsPath: 'ReWrite/KnownNouns.md',
	modelCache: { transcription: {}, llm: {} },
	localWhisper: DEFAULT_LOCAL_WHISPER,
};

const PROFILE_KINDS: ActiveProfileKind[] = ['desktop', 'mobile'];

// Secret ids must be lowercase-alphanumeric + dashes only (Obsidian's app.secretStorage.setSecret
// throws on colons/underscores). `kind` is always 'desktop' | 'mobile', so dash-joining stays valid.
function profileTranscriptionKeyId(kind: ActiveProfileKind): string {
	return `profile-${kind}-transcription`;
}

function profileLLMKeyId(kind: ActiveProfileKind): string {
	return `profile-${kind}-llm`;
}

export async function loadSettings(plugin: Plugin): Promise<GlobalSettings> {
	const stored = (await plugin.loadData()) as Partial<GlobalSettings> | null;
	const merged = mergeSettings(DEFAULT_SETTINGS, stored ?? {});
	await hydrateSecrets(plugin, merged);
	return merged;
}

export async function saveSettings(plugin: Plugin, settings: GlobalSettings): Promise<void> {
	await persistSecrets(plugin, settings);
	const stripped = stripSecrets(settings);
	await plugin.saveData(stripped);
}

export async function hydrateSecrets(plugin: Plugin, settings: GlobalSettings): Promise<void> {
	const all = await loadAllKeys(plugin);
	for (const kind of PROFILE_KINDS) {
		const profile = profileFor(settings, kind);
		const trKey = all[profileTranscriptionKeyId(kind)];
		profile.transcriptionConfig.apiKey = trKey ?? '';
		const llmKey = all[profileLLMKeyId(kind)];
		profile.llmConfig.apiKey = llmKey ?? '';
	}
}

async function persistSecrets(plugin: Plugin, settings: GlobalSettings): Promise<void> {
	const updates: Record<string, string> = {};
	for (const kind of PROFILE_KINDS) {
		const profile = profileFor(settings, kind);
		updates[profileTranscriptionKeyId(kind)] = profile.transcriptionConfig.apiKey;
		updates[profileLLMKeyId(kind)] = profile.llmConfig.apiKey;
	}
	await saveManyKeys(plugin, updates);
}

function stripSecrets(settings: GlobalSettings): GlobalSettings {
	return {
		...settings,
		desktopProfile: stripProfileKeys(settings.desktopProfile),
		mobileProfile: stripProfileKeys(settings.mobileProfile),
	};
}

function stripProfileKeys(profile: EnvironmentProfile): EnvironmentProfile {
	return {
		...profile,
		transcriptionConfig: { ...profile.transcriptionConfig, apiKey: '' },
		llmConfig: { ...profile.llmConfig, apiKey: '' },
	};
}

function profileFor(settings: GlobalSettings, kind: ActiveProfileKind): EnvironmentProfile {
	return kind === 'desktop' ? settings.desktopProfile : settings.mobileProfile;
}

export function mergeSettings(
	base: GlobalSettings,
	partial: Partial<GlobalSettings>,
): GlobalSettings {
	return {
		...base,
		...partial,
		activeProfileOverride: pickEnum(ACTIVE_PROFILE_OVERRIDES, partial.activeProfileOverride, base.activeProfileOverride),
		recordingFormat: pickEnum(RECORDING_FORMATS, partial.recordingFormat, base.recordingFormat),
		newFileCollisionMode: pickEnum(NEW_FILE_COLLISION_MODES, partial.newFileCollisionMode, base.newFileCollisionMode),
		desktopProfile: mergeProfile(base.desktopProfile, partial.desktopProfile),
		mobileProfile: mergeProfile(base.mobileProfile, partial.mobileProfile),
		modelCache: {
			transcription: {
				...base.modelCache.transcription,
				...(isPlainObject(partial.modelCache?.transcription) ? partial.modelCache.transcription : {}),
			},
			llm: {
				...base.modelCache.llm,
				...(isPlainObject(partial.modelCache?.llm) ? partial.modelCache.llm : {}),
			},
		},
		localWhisper: { ...base.localWhisper, ...(isPlainObject(partial.localWhisper) ? partial.localWhisper : {}) },
	};
}

function mergeProfile(
	base: EnvironmentProfile,
	partial: Partial<EnvironmentProfile> | undefined,
): EnvironmentProfile {
	if (!isPlainObject(partial)) return base;
	return {
		...base,
		...partial,
		transcriptionProvider: pickEnum(TRANSCRIPTION_PROVIDER_IDS, partial.transcriptionProvider, base.transcriptionProvider),
		llmProvider: pickEnum(LLM_PROVIDER_IDS, partial.llmProvider, base.llmProvider),
		transcriptionConfig: {
			...base.transcriptionConfig,
			...(isPlainObject(partial.transcriptionConfig) ? partial.transcriptionConfig : {}),
		},
		llmConfig: {
			...base.llmConfig,
			...(isPlainObject(partial.llmConfig) ? partial.llmConfig : {}),
		},
	};
}
