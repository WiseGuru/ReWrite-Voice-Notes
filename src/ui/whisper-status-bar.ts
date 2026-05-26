import { Notice, Platform } from 'obsidian';
import type ReWritePlugin from '../main';
import { formatWhisperStatus, WhisperOwnership, WhisperSnapshot, WhisperStatus } from '../whisper-host';
import { resolveActiveProfile } from '../platform';

const POLL_MS = 1000;
const DOT_VARIANTS = ['is-stopped', 'is-starting', 'is-running', 'is-external', 'is-crashed'];

export class WhisperStatusBar {
	private readonly el: HTMLElement;
	private readonly dot: HTMLElement;
	private readonly label: HTMLElement;
	private lastKey: string | null = null;
	private lastHidden: boolean | null = null;

	constructor(private readonly plugin: ReWritePlugin, host: HTMLElement) {
		this.el = host;
		this.el.addClass('rewrite-status-bar');
		this.dot = this.el.createSpan({ cls: 'rewrite-status-dot' });
		this.label = this.el.createSpan({ cls: 'rewrite-status-label' });
		this.el.addEventListener('click', () => {
			void this.toggle();
		});
	}

	start(): void {
		this.refresh();
		this.plugin.registerInterval(window.setInterval(() => this.refresh(), POLL_MS));
	}

	private refresh(): void {
		const hidden = this.shouldHide();
		if (hidden !== this.lastHidden) {
			this.el.toggleClass('rewrite-hidden', hidden);
			this.lastHidden = hidden;
		}
		if (hidden) return;

		const snap = this.plugin.whisperHost.snapshot();
		const key = snapshotKey(snap);
		if (key === this.lastKey) return;
		this.lastKey = key;

		for (const variant of DOT_VARIANTS) {
			this.dot.removeClass(variant);
		}
		this.dot.addClass(`is-${snap.status}`);
		this.label.setText(statusLabel(snap.status, snap.ownership));
		const long = formatWhisperStatus(snap);
		this.el.setAttr('aria-label', long);
		this.el.setAttr('title', long);
	}

	private shouldHide(): boolean {
		if (!Platform.isDesktop) return true;
		const { profile } = resolveActiveProfile(this.plugin.settings);
		return profile.transcriptionProvider !== 'whisper-local';
	}

	private async toggle(): Promise<void> {
		const host = this.plugin.whisperHost;
		const status = host.status();
		if (status === 'external') {
			const pid = host.pid();
			const where = host.baseUrl() ?? `port ${this.plugin.settings.localWhisper.port}`;
			new Notice(`External whisper-server on ${where}${pid !== null ? ` (pid ${pid})` : ''}. ReWrite won't stop a process it didn't start.`);
			return;
		}
		try {
			if (status === 'running' || status === 'starting') {
				await host.stop();
			} else {
				await host.start(this.plugin.settings.localWhisper);
			}
		} catch (e) {
			new Notice(e instanceof Error ? e.message : String(e));
		}
		this.lastKey = null;
		this.refresh();
	}
}

function snapshotKey(snap: WhisperSnapshot): string {
	return `${snap.status}|${snap.ownership ?? ''}|${snap.pid ?? ''}|${snap.baseUrl ?? ''}`;
}

function statusLabel(status: WhisperStatus, ownership: WhisperOwnership | null): string {
	switch (status) {
		case 'stopped':
			return 'Whisper: stopped';
		case 'starting':
			return 'Whisper: starting';
		case 'running':
			return ownership === 'adopted' ? 'Whisper: running (adopted)' : 'Whisper: running';
		case 'external':
			return 'Whisper: external';
		case 'crashed':
			return 'Whisper: crashed';
	}
}
