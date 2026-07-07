import tseslint from 'typescript-eslint';
import obsidianmd from "eslint-plugin-obsidianmd";
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
