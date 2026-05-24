import { Plugin } from 'obsidian';
import { loadSettings, saveSettings } from './settings';
import { ReWriteSettingTab } from './settings/tab';
import { GlobalSettings } from './types';

export default class ReWritePlugin extends Plugin {
	settings!: GlobalSettings;

	async onload(): Promise<void> {
		this.settings = await loadSettings(this);
		this.addSettingTab(new ReWriteSettingTab(this.app, this));
	}

	async saveSettings(): Promise<void> {
		await saveSettings(this, this.settings);
	}
}
