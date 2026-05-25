import { Plugin } from 'obsidian';
import {
	ActiveProfileKind,
	EnvironmentProfile,
	GlobalSettings,
	LLMConfig,
	TranscriptionConfig,
} from '../types';
import { loadAllKeys, saveManyKeys } from '../secrets';
import { freshDefaultTemplates } from './default-templates';

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
	maxTokens: 2048,
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
	transcriptionProvider: 'webspeech',
	transcriptionConfig: { ...EMPTY_TRANSCRIPTION_CONFIG },
	llmProvider: 'anthropic',
	llmConfig: { ...EMPTY_LLM_CONFIG },
};

export const DEFAULT_SETTINGS: GlobalSettings = {
	activeProfileOverride: 'auto',
	desktopProfile: DESKTOP_DEFAULT_PROFILE,
	mobileProfile: MOBILE_DEFAULT_PROFILE,
	defaultTemplateId: '',
	lastUsedTemplateId: '',
	recordingFormat: 'webm',
	templates: [],
};

const PROFILE_KINDS: ActiveProfileKind[] = ['desktop', 'mobile'];

function profileTranscriptionKeyId(kind: ActiveProfileKind): string {
	return `profile:${kind}:transcription`;
}

function profileLLMKeyId(kind: ActiveProfileKind): string {
	return `profile:${kind}:llm`;
}

export async function loadSettings(plugin: Plugin): Promise<GlobalSettings> {
	const stored = (await plugin.loadData()) as Partial<GlobalSettings> | null;
	const merged = mergeSettings(DEFAULT_SETTINGS, stored ?? {});
	if (merged.templates.length === 0) {
		merged.templates = freshDefaultTemplates();
		if (!merged.defaultTemplateId) {
			merged.defaultTemplateId = merged.templates[0]?.id ?? '';
		}
	}
	await hydrateSecrets(plugin, merged);
	return merged;
}

export async function saveSettings(plugin: Plugin, settings: GlobalSettings): Promise<void> {
	await persistSecrets(plugin, settings);
	const stripped = stripSecrets(settings);
	await plugin.saveData(stripped);
}

async function hydrateSecrets(plugin: Plugin, settings: GlobalSettings): Promise<void> {
	const all = await loadAllKeys(plugin);
	for (const kind of PROFILE_KINDS) {
		const profile = profileFor(settings, kind);
		const trKey = all[profileTranscriptionKeyId(kind)];
		if (trKey) profile.transcriptionConfig.apiKey = trKey;
		const llmKey = all[profileLLMKeyId(kind)];
		if (llmKey) profile.llmConfig.apiKey = llmKey;
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

function mergeSettings(
	base: GlobalSettings,
	partial: Partial<GlobalSettings>,
): GlobalSettings {
	return {
		...base,
		...partial,
		desktopProfile: mergeProfile(base.desktopProfile, partial.desktopProfile),
		mobileProfile: mergeProfile(base.mobileProfile, partial.mobileProfile),
		templates: partial.templates ?? base.templates,
	};
}

function mergeProfile(
	base: EnvironmentProfile,
	partial: Partial<EnvironmentProfile> | undefined,
): EnvironmentProfile {
	if (!partial) return base;
	return {
		...base,
		...partial,
		transcriptionConfig: {
			...base.transcriptionConfig,
			...(partial.transcriptionConfig ?? {}),
		},
		llmConfig: {
			...base.llmConfig,
			...(partial.llmConfig ?? {}),
		},
	};
}
