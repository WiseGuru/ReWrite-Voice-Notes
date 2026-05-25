import { App } from 'obsidian';
import { EnvironmentProfile, GlobalSettings, NoteTemplate } from './types';
import { createTranscriptionProvider } from './transcription';
import { createLLMProvider } from './llm';
import { insertOutput, InsertResult } from './insert';

export type PipelineStage = 'transcribe' | 'cleanup' | 'insert';

export type PipelineSource =
	| { kind: 'audio'; audio: Blob }
	| { kind: 'paste'; text: string }
	| { kind: 'webspeech'; transcript: string }
	| { kind: 'text'; text: string };

export interface PipelineParams {
	app: App;
	settings: GlobalSettings;
	profile: EnvironmentProfile;
	template: NoteTemplate;
	source: PipelineSource;
	onStage?: (stage: PipelineStage) => void;
	signal?: AbortSignal;
}

export interface PipelineResult {
	transcript: string;
	cleaned: string;
	insert: InsertResult;
}

export async function runPipeline(params: PipelineParams): Promise<PipelineResult> {
	const transcript = (await collectTranscript(params)).trim();
	if (!transcript) {
		throw new Error('Transcript is empty; nothing to clean up.');
	}

	params.onStage?.('cleanup');
	const cleaned = await cleanupTranscript(params, transcript);

	params.onStage?.('insert');
	const insert = await insertOutput({
		app: params.app,
		template: params.template,
		content: cleaned,
	});

	return { transcript, cleaned, insert };
}

async function collectTranscript(params: PipelineParams): Promise<string> {
	const source = params.source;
	switch (source.kind) {
		case 'paste':
		case 'text':
			return source.text;
		case 'webspeech':
			return source.transcript;
		case 'audio': {
			params.onStage?.('transcribe');
			const provider = createTranscriptionProvider(params.profile.transcriptionProvider);
			return provider.transcribe(source.audio, params.profile.transcriptionConfig, params.signal);
		}
	}
}

async function cleanupTranscript(params: PipelineParams, transcript: string): Promise<string> {
	const llm = createLLMProvider(params.profile.llmProvider);
	try {
		return await llm.complete(params.template.prompt, transcript, params.profile.llmConfig, params.signal);
	} catch (e) {
		const original = e instanceof Error ? e : new Error(String(e));
		try {
			await navigator.clipboard.writeText(transcript);
			throw new Error(`${original.message} (Raw transcript copied to clipboard as fallback.)`);
		} catch (clipErr) {
			if (clipErr instanceof Error && clipErr.message.includes('copied to clipboard')) {
				throw clipErr;
			}
			throw new Error(`${original.message} (Clipboard fallback also failed.)`);
		}
	}
}
