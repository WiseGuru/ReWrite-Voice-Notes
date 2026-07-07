import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'url';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
	plugins: [
		// src/*.ts uses bare imports like `from 'passphrase-strength'` relying on tsconfig.json's
		// baseUrl: "src" (resolved natively by esbuild's bundler at build time); Vite/Vitest don't
		// know about baseUrl without this plugin reading tsconfig for us.
		tsconfigPaths(),
	],
	test: {
		environment: 'node',
		include: ['test/**/*.test.ts'],
		setupFiles: ['test/setup.ts'],
	},
	resolve: {
		alias: {
			// The real `obsidian` npm package ships no runtime JS, only .d.ts files. Modules
			// under test import runtime values (Notice, normalizePath, parseYaml, ...) from it,
			// so tests need something real to resolve to; see test/mocks/obsidian.ts.
			obsidian: fileURLToPath(new URL('./test/mocks/obsidian.ts', import.meta.url)),
		},
	},
});
