// Obsidian's real runtime (Electron/browser) always has a global `crypto` (Web Crypto), which
// secrets.ts relies on without importing it. Node exposes it as a global automatically only on
// newer runtimes; polyfill it from node:crypto so the test environment matches regardless of
// which Node version is running the suite.
import { webcrypto } from 'node:crypto';

if (typeof globalThis.crypto === 'undefined') {
	Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}
