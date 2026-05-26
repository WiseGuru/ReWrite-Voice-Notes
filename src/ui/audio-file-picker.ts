import { App, FuzzySuggestModal, TFile } from 'obsidian';

export interface AudioFilePickerParams {
	app: App;
	files: TFile[];
	onPick: (file: TFile) => void;
}

export class AudioFilePickerModal extends FuzzySuggestModal<TFile> {
	constructor(private readonly params: AudioFilePickerParams) {
		super(params.app);
		this.setPlaceholder('Search audio files in your vault...');
	}

	getItems(): TFile[] {
		return this.params.files;
	}

	getItemText(file: TFile): string {
		return file.path;
	}

	onChooseItem(file: TFile): void {
		this.params.onPick(file);
	}
}
