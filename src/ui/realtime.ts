import { Editor, MarkdownView, Notice } from 'obsidian';
import type ReWritePlugin from '../main';
import { resolveActiveProfile } from '../platform';
import {
	createRealtimeProvider,
	RealtimeSession,
	transcriptionProviderSupportsRealtime,
} from '../realtime';
import { isPcmCaptureAvailable, PcmCapture, REALTIME_SAMPLE_RATE } from '../realtime/pcm';

// Realtime dictation: stream mic audio to the provider and type finalized
// segments at the editor cursor as they arrive. Deliberately minimal by design
// (roadmap item 2): command/shortcut only, no template, no LLM cleanup, no
// audio persistence — the transcript lands raw, like typing.
export class RealtimeController {
	private capture: PcmCapture | null = null;
	private session: RealtimeSession | null = null;
	private floater: RealtimeFloater | null = null;
	private settled = false;

	constructor(
		private readonly plugin: ReWritePlugin,
		private readonly editor: Editor,
		private readonly onDispose: () => void,
	) {}

	async begin(): Promise<void> {
		const { profile } = resolveActiveProfile(this.plugin.settings);
		const provider = createRealtimeProvider(profile.realtimeProvider);
		const capture = new PcmCapture();
		this.capture = capture;

		try {
			this.session = await provider.start(profile.realtimeConfig, REALTIME_SAMPLE_RATE, {
				onFinal: (text) => this.insertFinal(text),
				onInterim: (text) => this.floater?.setInterim(text),
				onError: (error) => {
					new Notice(`ReWrite realtime: ${error.message}`);
					this.teardown();
				},
				onUnexpectedClose: () => {
					if (this.settled) return;
					new Notice('ReWrite realtime: the connection closed.');
					this.teardown();
				},
			});

			await capture.start((chunk) => this.session?.sendAudio(chunk));

			this.floater = new RealtimeFloater({
				onStop: () => {
					void this.finish();
				},
			});
		} catch (e) {
			// Any startup failure (socket open, mic access, node setup): tear down whatever
			// partially initialized so a half-open session, a live mic, or an AudioContext
			// can't leak. capture.stop() is a safe no-op if start() never assigned anything.
			capture.stop();
			this.capture = null;
			if (this.session) {
				await this.session.stop().catch(() => { /* best effort */ });
				this.session = null;
			}
			throw e;
		}
	}

	// Graceful stop: end capture, let the provider flush trailing finals (still
	// inserted through insertFinal while we wait), then dispose.
	async finish(): Promise<void> {
		if (this.settled) return;
		this.settled = true;
		this.floater?.setBusy('Finishing...');
		this.capture?.stop();
		this.capture = null;
		try {
			await this.session?.stop();
		} catch (e) {
			console.error('ReWrite: realtime stop failed', e);
		}
		this.session = null;
		this.floater?.dispose();
		this.floater = null;
		this.onDispose();
	}

	// Hard teardown for errors and plugin unload: no flush, just release everything.
	cancel(): void {
		this.teardown();
	}

	private teardown(): void {
		if (this.settled) return;
		this.settled = true;
		this.capture?.stop();
		this.capture = null;
		const session = this.session;
		this.session = null;
		if (session) void session.stop().catch(() => { /* best effort */ });
		this.floater?.dispose();
		this.floater = null;
		this.onDispose();
	}

	private insertFinal(text: string): void {
		this.floater?.setInterim('');
		try {
			// Behaves like typing: inserts at the cursor (or over a selection) and
			// moves the cursor past the inserted text, so consecutive segments chain.
			this.editor.replaceSelection(`${text} `);
		} catch (e) {
			console.error('ReWrite: realtime insert failed', e);
			new Notice('ReWrite realtime: the note editor went away; stopping.');
			this.teardown();
		}
	}
}

// One realtime session at a time, owned by the plugin (mirrors activeQuickRecord).
export async function startRealtimeTranscription(
	plugin: ReWritePlugin,
	onDispose: () => void,
): Promise<RealtimeController | null> {
	const { profile } = resolveActiveProfile(plugin.settings);

	if (plugin.encryptionStatus.locked) {
		new Notice('ReWrite: API keys are locked. Unlock to use realtime transcription.');
		plugin.promptUnlock();
		return null;
	}
	if (!transcriptionProviderSupportsRealtime(profile.realtimeProvider)) {
		new Notice('ReWrite: set the real-time provider to AssemblyAI or Deepgram in this profile\'s real-time transcription settings.');
		return null;
	}
	if (!profile.realtimeConfig.apiKey) {
		new Notice('ReWrite: set the real-time transcription API key in settings first.');
		return null;
	}
	if (!isPcmCaptureAvailable()) {
		new Notice('ReWrite: audio capture is not supported in this environment.');
		return null;
	}
	const editor = plugin.app.workspace.getActiveViewOfType(MarkdownView)?.editor;
	if (!editor) {
		new Notice('ReWrite: open a Markdown note first; the live transcript is typed at the cursor.');
		return null;
	}

	const controller = new RealtimeController(plugin, editor, onDispose);
	try {
		await controller.begin();
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		new Notice(`ReWrite realtime could not start: ${msg}`);
		onDispose();
		return null;
	}
	return controller;
}

interface RealtimeFloaterOptions {
	onStop: () => void;
}

// Floating status bar for a live session: pulsing dot, rolling interim text,
// and a Stop button. Mirrors the Quick Record floater's lifecycle (a
// document.body div owned by the controller, cleaned up via dispose()).
class RealtimeFloater {
	private readonly el: HTMLElement;
	private readonly interimEl: HTMLElement;
	private readonly stopBtn: HTMLButtonElement;
	private busy = false;

	constructor(options: RealtimeFloaterOptions) {
		this.el = activeDocument.body.createDiv({ cls: 'rewrite-quick-floater rewrite-realtime-floater' });
		const row = this.el.createDiv({ cls: 'rewrite-quick-row' });
		row.createSpan({ cls: 'rewrite-quick-dot' });
		row.createSpan({ cls: 'rewrite-quick-label', text: 'Live transcription' });
		this.stopBtn = row.createEl('button', {
			text: 'Stop',
			cls: 'mod-cta rewrite-quick-stop',
		});
		this.stopBtn.addEventListener('click', () => {
			if (this.busy) return;
			options.onStop();
		});
		this.interimEl = this.el.createDiv({ cls: 'rewrite-realtime-interim' });
		this.interimEl.hide();
	}

	setInterim(text: string): void {
		if (this.busy) return;
		if (!text) {
			this.interimEl.hide();
			this.interimEl.setText('');
			return;
		}
		this.interimEl.setText(text);
		this.interimEl.show();
	}

	setBusy(label: string): void {
		this.busy = true;
		this.el.addClass('is-busy');
		this.interimEl.setText(label);
		this.interimEl.show();
		this.stopBtn.disabled = true;
	}

	dispose(): void {
		this.el.remove();
	}
}
