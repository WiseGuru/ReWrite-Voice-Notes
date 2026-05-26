import { App, Modal, Notice, Setting } from 'obsidian';

export interface PassphrasePromptParams {
	app: App;
	title: string;
	description?: string;
	confirmLabel?: string;
	// When true, render a second "Confirm passphrase" field that must match.
	requireConfirm?: boolean;
	// Called with the entered passphrase. Throw to keep the modal open and surface an error.
	onSubmit: (passphrase: string) => Promise<void>;
}

export class PassphraseModal extends Modal {
	private passphrase = '';
	private confirm = '';
	private busy = false;
	private errorEl: HTMLElement | null = null;

	constructor(private readonly params: PassphrasePromptParams) {
		super(params.app);
	}

	onOpen(): void {
		this.modalEl.addClass('rewrite-modal');
		this.modalEl.addClass('rewrite-passphrase-modal');
		const { contentEl } = this;
		contentEl.createEl('h2', { text: this.params.title });

		if (this.params.description) {
			contentEl.createEl('p', { text: this.params.description, cls: 'rewrite-passphrase-desc' });
		}

		if (this.params.requireConfirm) {
			this.renderPassphraseTips(contentEl);
		}

		new Setting(contentEl)
			.setName('Passphrase')
			.addText((t) => {
				t.inputEl.type = 'password';
				t.inputEl.addClass('rewrite-passphrase-input');
				t.inputEl.autofocus = true;
				t.onChange((v) => { this.passphrase = v; });
				t.inputEl.addEventListener('keydown', (e) => this.onKeydown(e));
			});

		if (this.params.requireConfirm) {
			new Setting(contentEl)
				.setName('Confirm passphrase')
				.addText((t) => {
					t.inputEl.type = 'password';
					t.inputEl.addClass('rewrite-passphrase-input');
					t.onChange((v) => { this.confirm = v; });
					t.inputEl.addEventListener('keydown', (e) => this.onKeydown(e));
				});

			contentEl.createEl('p', {
				text: 'If you lose this passphrase, you will need to re-enter every API key. There is no recovery.',
				cls: 'rewrite-passphrase-warning',
			});
		}

		this.errorEl = contentEl.createEl('p', { cls: 'rewrite-passphrase-error rewrite-hidden' });

		const actions = contentEl.createDiv({ cls: 'rewrite-passphrase-actions' });
		const submit = actions.createEl('button', { text: this.params.confirmLabel ?? 'Unlock', cls: 'mod-cta' });
		submit.addEventListener('click', () => { void this.submit(); });
		const cancel = actions.createEl('button', { text: 'Cancel' });
		cancel.addEventListener('click', () => this.close());
	}

	onClose(): void {
		this.passphrase = '';
		this.confirm = '';
		this.contentEl.empty();
	}

	private renderPassphraseTips(parent: HTMLElement): void {
		const tips = parent.createDiv({ cls: 'rewrite-passphrase-tips' });
		tips.createEl('strong', { text: 'Picking a strong passphrase' });

		const list = tips.createEl('ul');

		const li1 = list.createEl('li');
		li1.createSpan({ text: 'Length beats complexity. A 5-6 word diceware-style password (like one you can generate ' });
		appendExternalLink(li1, 'here', 'https://www.keepersecurity.com/features/passphrase-generator/');
		li1.createSpan({ text: ') is far stronger than ' });
		li1.createEl('code', { text: 'P@ssw0rd!' });
		li1.createSpan({ text: ' and much easier to remember than ' });
		// eslint-disable-next-line obsidianmd/ui/sentence-case
		li1.createEl('code', { text: 'xv^02>lWP6nm2gR' });
		li1.createSpan({ text: '.' });

		const li2 = list.createEl('li');
		li2.createEl('strong', { text: 'Never reuse a password from elsewhere.' });
		li2.createSpan({ text: ' If it appears in a breach corpus, it can be cracked instantly no matter how complex it looks.' });

		const li3 = list.createEl('li');
		li3.createSpan({ text: 'Check candidates against ' });
		appendExternalLink(li3, 'haveibeenpwned.com/Passwords', 'https://haveibeenpwned.com/Passwords');
		li3.createSpan({ text: ' before using them. See ' });
		appendExternalLink(li3, 'hivesystems.com/password', 'https://www.hivesystems.com/password');
		li3.createSpan({ text: ' for brute-force time estimates by length and character class.' });
	}

	private onKeydown(e: KeyboardEvent): void {
		if (e.key === 'Enter') {
			e.preventDefault();
			void this.submit();
		}
	}

	private setError(msg: string): void {
		if (!this.errorEl) return;
		this.errorEl.setText(msg);
		this.errorEl.removeClass('rewrite-hidden');
	}

	private clearError(): void {
		if (!this.errorEl) return;
		this.errorEl.setText('');
		this.errorEl.addClass('rewrite-hidden');
	}

	private async submit(): Promise<void> {
		if (this.busy) return;
		this.clearError();

		if (this.passphrase.length === 0) {
			this.setError('Enter a passphrase.');
			return;
		}
		if (this.params.requireConfirm && this.passphrase !== this.confirm) {
			this.setError('Passphrases do not match.');
			return;
		}
		this.busy = true;
		try {
			await this.params.onSubmit(this.passphrase);
			this.close();
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			this.setError(msg);
			new Notice(msg);
		} finally {
			this.busy = false;
		}
	}
}

function appendExternalLink(parent: HTMLElement, label: string, href: string): void {
	const a = parent.createEl('a', { text: label, href });
	a.target = '_blank';
	a.rel = 'noopener noreferrer';
}
