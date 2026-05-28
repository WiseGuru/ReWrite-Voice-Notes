import { Platform } from 'obsidian';
import { ActiveProfileKind, EnvironmentProfile, GlobalSettings } from './types';

export function detectActiveProfileKind(settings: GlobalSettings): ActiveProfileKind {
	switch (settings.activeProfileOverride) {
		case 'desktop':
			return 'desktop';
		case 'mobile':
			return 'mobile';
		case 'auto':
		default:
			return Platform.isDesktop ? 'desktop' : 'mobile';
	}
}

export function resolveActiveProfile(settings: GlobalSettings): {
	kind: ActiveProfileKind;
	profile: EnvironmentProfile;
} {
	const kind = detectActiveProfileKind(settings);
	const profile = kind === 'desktop' ? settings.desktopProfile : settings.mobileProfile;
	return { kind, profile };
}

export function isMediaRecorderAvailable(): boolean {
	return typeof MediaRecorder !== 'undefined' && typeof navigator !== 'undefined' && !!navigator.mediaDevices;
}
