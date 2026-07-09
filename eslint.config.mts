import tseslint from 'typescript-eslint';
import obsidianmd from "eslint-plugin-obsidianmd";
// The Obsidian community-review bot runs a newer eslint-plugin-obsidianmd than our
// pinned 0.1.9 base, whose `no-unsupported-api` rule (flags a direct Obsidian API call
// newer than manifest `minAppVersion`) is what caught `FileManager.trashFile` at
// submission. We keep 0.1.9 as the base config (its `ui/sentence-case` is the one the bot
// actually enforces; 0.4.x's is over-aggressive and produces wrong fixes), and cherry-pick
// ONLY that one rule from a 0.4.1 alias so the minAppVersion check runs locally too.
import obsidianmdLatest from "obsidianmd-latest";
import globals from "globals";
import { globalIgnores } from "eslint/config";

// Mirror the plugin's DEFAULT_BRANDS / DEFAULT_ACRONYMS (the rule replaces the
// defaults when options are passed, so we have to provide the full lists) plus
// the extras this project needs: provider names, "ReWrite", "LLM".
const DEFAULT_BRANDS = [
	"iOS", "iPadOS", "macOS", "Windows", "Android", "Linux",
	"Obsidian", "Obsidian Sync", "Obsidian Publish",
	"Google Drive", "Dropbox", "OneDrive", "iCloud Drive",
	"YouTube", "Slack", "Discord", "Telegram", "WhatsApp", "Twitter", "X",
	"Readwise", "Zotero",
	"Excalidraw", "Mermaid",
	"Markdown", "LaTeX", "JavaScript", "TypeScript", "Node.js",
	"npm", "pnpm", "Yarn", "Git", "GitHub",
	"GitLab", "Notion", "Evernote", "Roam Research", "Logseq", "Anki", "Reddit",
	"VS Code", "Visual Studio Code", "IntelliJ IDEA", "WebStorm", "PyCharm",
];

const DEFAULT_ACRONYMS = [
	"API", "HTTP", "HTTPS", "URL", "DNS", "TCP", "IP", "SSH", "TLS", "SSL", "FTP", "SFTP", "SMTP",
	"JSON", "XML", "HTML", "CSS", "PDF", "CSV", "YAML", "SQL", "PNG", "JPG", "JPEG", "GIF", "SVG",
	"2FA", "MFA", "OAuth", "JWT", "LDAP", "SAML",
	"SDK", "IDE", "CLI", "GUI", "CRUD", "REST", "SOAP",
	"CPU", "GPU", "RAM", "SSD", "USB",
	"UI", "OK",
	"RSS", "S3", "WebDAV",
	"ID",
	"UUID", "GUID", "SHA", "MD5", "ASCII", "UTF-8", "UTF-16", "DOM", "CDN", "FAQ", "AI", "ML",
];

const REWRITE_BRANDS = [
	"ReWrite",
	"OpenAI", "Whisper",
	"Anthropic", "Claude",
	"Google Gemini", "Gemini",
	"Groq", "Mistral", "Voxtral",
	"Ollama", "LM Studio",
	"AssemblyAI", "Deepgram", "Rev.ai",
	"whisper.cpp", "whisper-server", "faster-whisper-server",
	"Argon2id", "Argon2", "zxcvbn", "diceware", "EFF",
];

const REWRITE_ACRONYMS = [
	"LLM", "STT", "TTS",
	"OS", "PBKDF2", "AES", "GCM", "KDF",
];

const sentenceCaseOptions = {
	brands: [...DEFAULT_BRANDS, ...REWRITE_BRANDS],
	acronyms: [...DEFAULT_ACRONYMS, ...REWRITE_ACRONYMS],
};

export default tseslint.config(
	{
		// The community-review bot rejects `eslint-disable` directives (it flags both the
		// undescribed comment and disabling a rule at all). `noInlineConfig` makes every inline
		// eslint directive inert, so a rule (ours or the bot's) cannot be silenced from a
		// comment: an attempt to suppress a real error just leaves the error in place and fails
		// `npm run lint`. Reach APIs outside the typed/deprecated surface through local
		// type-aliases instead (see src/realtime/pcm.ts), never a disable comment.
		linterOptions: {
			noInlineConfig: true,
		},
		languageOptions: {
			globals: {
				...globals.browser,
				// Obsidian ambient globals (popout-window aware; declared in obsidian.d.ts,
				// which TS sees but eslint's no-undef does not).
				activeDocument: 'readonly',
				activeWindow: 'readonly',
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: [
						'eslint.config.mts',
						'manifest.json'
					]
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json']
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		plugins: { obsidianmd },
		rules: {
			'obsidianmd/ui/sentence-case': ['error', sentenceCaseOptions],
			'obsidianmd/ui/sentence-case-json': ['error', sentenceCaseOptions],
			'obsidianmd/ui/sentence-case-locale-module': ['error', sentenceCaseOptions],
		},
	},
	{
		// Type-checked rules the Obsidian community-review bot runs but the local
		// obsidianmd recommended config does not turn on. Enabling them here gives
		// local parity with the reviewer so these never surface only at submission
		// time again. Scoped to source (test/ keeps its own relaxations below).
		files: ['src/**/*.ts'],
		plugins: { '@typescript-eslint': tseslint.plugin },
		rules: {
			'@typescript-eslint/no-deprecated': 'error',
			'@typescript-eslint/no-unsafe-assignment': 'error',
			'@typescript-eslint/no-unsafe-call': 'error',
			'@typescript-eslint/no-unsafe-member-access': 'error',
			'@typescript-eslint/no-unsafe-argument': 'error',
			'@typescript-eslint/no-unsafe-return': 'error',
			'@typescript-eslint/no-unnecessary-type-assertion': 'error',
		},
	},
	{
		// Cherry-picked from the 0.4.1 alias (see the import comment): the single rule that
		// flags a direct Obsidian API newer than manifest `minAppVersion`. Registering the
		// plugin only makes its rules available; nothing else from 0.4.1 runs unless enabled
		// here, so its divergent sentence-case rule stays off. This is the check that would
		// have caught `trashFile` locally before the 1.2.0 submission.
		files: ['src/**/*.ts'],
		plugins: { 'obsidianmd-latest': obsidianmdLatest },
		rules: {
			'obsidianmd-latest/no-unsupported-api': 'error',
		},
	},
	{
		// test/ runs under Node via Vitest, not inside Obsidian, so the Node-builtin ban that
		// keeps src/ portable to the Electron/mobile plugin runtime doesn't apply here.
		files: ['test/**/*.ts'],
		rules: {
			'import/no-nodejs-modules': 'off',
		},
	},
	{
		// These two files test the plain-JS dev scripts (local-review.mjs /
		// prepare-release-vault.mjs), which ship no type declarations, so every import from
		// them is typed `any` and trips the type-safety rules purely on that (not a real unsafe
		// access). `hardcoded-config-path` is an Obsidian-runtime rule about `Vault#configDir`;
		// it does not apply to a release-prep build script that copies into a fixed
		// `.obsidian/plugins/` path. Relaxations scoped to just these two files.
		files: ['test/local-review.test.ts', 'test/prepare-release-vault.test.ts'],
		rules: {
			'@typescript-eslint/no-unsafe-call': 'off',
			'@typescript-eslint/no-unsafe-member-access': 'off',
			'@typescript-eslint/no-unsafe-return': 'off',
			'@typescript-eslint/no-unsafe-assignment': 'off',
			'obsidianmd/hardcoded-config-path': 'off',
		},
	},
	globalIgnores([
		"node_modules",
		"dist",
		"esbuild.config.mjs",
		"eslint.config.mts",
		"version-bump.mjs",
		"local-review.mjs",
		"prepare-release-vault.mjs",
		"dev-tools.config.example.json",
		"versions.json",
		"main.js",
		"vitest.config.ts",
	]),
);
