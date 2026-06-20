import { App, Modal, Notice } from 'obsidian';

export interface ConfirmModalParams {
	app: App;
	title: string;
	// Plain-text body. Rendered as a paragraph; newlines split into separate paragraphs.
	body: string;
	confirmLabel?: string;
	// Extra class for the confirm button (e.g. 'mod-warning' for a destructive action).
	confirmCls?: string;
	// Called when the user confirms. Throw to surface an error and keep the modal open.
	onConfirm: () => Promise<void>;
}

// A small generic confirmation modal. window.confirm is banned by ESLint (no-alert), and the
// only other modals (RenamePromptModal, PassphraseModal) are purpose-built, so destructive or
// consequential actions that just need an OK/Cancel use this. Reuses the rewrite-modal styling.
export class ConfirmModal extends Modal {
	private busy = false;

	constructor(private readonly params: ConfirmModalParams) {
		super(params.app);
	}

	onOpen(): void {
		this.modalEl.addClass('rewrite-modal');
		this.modalEl.addClass('rewrite-confirm-modal');
		const { contentEl } = this;
		contentEl.createEl('h2', { text: this.params.title });

		for (const line of this.params.body.split('\n')) {
			contentEl.createEl('p', { text: line, cls: 'rewrite-confirm-body' });
		}

		const actions = contentEl.createDiv({ cls: 'rewrite-passphrase-actions' });
		const confirm = actions.createEl('button', {
			text: this.params.confirmLabel ?? 'Confirm',
			cls: this.params.confirmCls ? `mod-cta ${this.params.confirmCls}` : 'mod-cta',
		});
		confirm.addEventListener('click', () => { void this.run(); });
		const cancel = actions.createEl('button', { text: 'Cancel' });
		cancel.addEventListener('click', () => this.close());
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async run(): Promise<void> {
		if (this.busy) return;
		this.busy = true;
		try {
			await this.params.onConfirm();
			this.close();
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			new Notice(msg);
		} finally {
			this.busy = false;
		}
	}
}
