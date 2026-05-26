export interface AdHocExtraction {
	transcript: string;
	instructions: string[];
}

const FILLER = /^(?:uh|um|er|okay|ok|never\s*mind|scratch\s*that|cancel\s*that|forget\s*that|nothing)\s*[.!?]?\s*$/i;

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function extractAdHocInstructions(transcript: string, name: string): AdHocExtraction {
	const trimmedName = name.trim();
	if (!trimmedName) return { transcript, instructions: [] };

	const safe = escapeRegex(trimmedName);
	const pattern = new RegExp(
		`\\b${safe}\\s*,\\s*([^.!?]*?)(?:([.!?])(?=\\s|$)|(?=\\b${safe}\\b)|$)`,
		'gi',
	);

	const instructions: string[] = [];
	const stripped = transcript.replace(pattern, (_full: string, body: string) => {
		const cleaned = body.trim();
		if (cleaned.length >= 2 && !FILLER.test(cleaned)) {
			instructions.push(cleaned);
		}
		return '';
	});

	const finalText = stripped
		.replace(/[ \t]+/g, ' ')
		.replace(/ +([.!?,;:])/g, '$1')
		.replace(/[ \t]*\n[ \t]*/g, '\n')
		.trim();

	return { transcript: finalText, instructions };
}
