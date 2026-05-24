import tseslint from 'typescript-eslint';
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import { globalIgnores } from "eslint/config";

// Mirror the plugin's DEFAULT_BRANDS / DEFAULT_ACRONYMS (the rule replaces the
// defaults when options are passed, so we have to provide the full lists) plus
// the extras this project needs: provider names, "Web Speech", "ReWrite", "LLM".
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
	"Web Speech",
	"OpenAI", "Whisper",
	"Anthropic", "Claude",
	"Google Gemini", "Gemini",
	"Groq", "Mistral",
	"Ollama", "LM Studio",
	"AssemblyAI", "Deepgram", "Rev.ai",
];

const REWRITE_ACRONYMS = [
	"LLM", "STT", "TTS",
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
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: [
						'eslint.config.js',
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
	globalIgnores([
		"node_modules",
		"dist",
		"esbuild.config.mjs",
		"eslint.config.js",
		"version-bump.mjs",
		"versions.json",
		"main.js",
	]),
);
