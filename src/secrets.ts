import { normalizePath, Platform, Plugin } from 'obsidian';

const SECRETS_FILE = 'secrets.json.nosync';
const SECRETS_VERSION = 2;
const VERIFIER_PLAINTEXT = 'rewrite-passphrase-verifier-v1';
const PBKDF2_ITERATIONS = 600_000;
const PBKDF2_SALT_BYTES = 16;
const AES_IV_BYTES = 12;
const VALUE_SEP = '.';

export type EncryptionMode = 'safeStorage' | 'plaintext' | 'passphrase';

export interface EncryptionStatus {
	mode: EncryptionMode;
	locked: boolean;
	safeStorageAvailable: boolean;
	safeStorageBackend: string | null;
}

interface PassphraseKdf {
	iterations: number;
	salt: string; // base64
}

interface SecretsEnvelope {
	version: number;
	mode: EncryptionMode;
	kdf?: PassphraseKdf;
	verifier?: string; // "<iv-b64>.<ct-b64>"
	keys: Record<string, string>;
}

interface SafeStorageAPI {
	isEncryptionAvailable(): boolean;
	encryptString(plain: string): { toString(encoding: string): string };
	decryptString(buf: unknown): string;
	getSelectedStorageBackend?(): string;
}

let safeStorageCache: SafeStorageAPI | null | undefined;
let cachedEnvelope: SecretsEnvelope | null = null;
let unlockedKey: CryptoKey | null = null;

function getSafeStorage(): SafeStorageAPI | null {
	if (safeStorageCache !== undefined) return safeStorageCache;
	if (!Platform.isDesktop) {
		safeStorageCache = null;
		return null;
	}
	try {
		const req =
			(window as unknown as { require?: (m: string) => unknown }).require ??
			(globalThis as unknown as { require?: (m: string) => unknown }).require;
		if (typeof req !== 'function') {
			safeStorageCache = null;
			return null;
		}
		const electron = req('electron') as { safeStorage?: SafeStorageAPI } | undefined;
		const ss = electron?.safeStorage;
		if (ss && typeof ss.isEncryptionAvailable === 'function' && ss.isEncryptionAvailable()) {
			safeStorageCache = ss;
			return ss;
		}
	} catch {
		// fall through
	}
	safeStorageCache = null;
	return null;
}

function getSafeStorageBackend(): string | null {
	const ss = getSafeStorage();
	if (!ss || typeof ss.getSelectedStorageBackend !== 'function') return null;
	try {
		return ss.getSelectedStorageBackend();
	} catch {
		return null;
	}
}

function secretsPath(plugin: Plugin): string {
	const dir = plugin.manifest.dir;
	if (!dir) throw new Error('Plugin manifest.dir is missing');
	return normalizePath(`${dir}/${SECRETS_FILE}`);
}

function defaultEnvelope(): SecretsEnvelope {
	return {
		version: SECRETS_VERSION,
		mode: getSafeStorage() ? 'safeStorage' : 'plaintext',
		keys: {},
	};
}

function isObject(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseEnvelope(raw: string): SecretsEnvelope {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return defaultEnvelope();
	}
	if (!isObject(parsed)) return defaultEnvelope();
	const version = typeof parsed.version === 'number' ? parsed.version : 1;
	if (version !== SECRETS_VERSION) {
		// Pre-release: no migrations. Treat unknown shapes as a fresh start.
		// Existing v1 dev installs will need to re-enter their API keys.
		return defaultEnvelope();
	}
	const mode = parsed.mode;
	if (mode !== 'safeStorage' && mode !== 'plaintext' && mode !== 'passphrase') {
		return defaultEnvelope();
	}
	const keys = isObject(parsed.keys) ? parsed.keys as Record<string, string> : {};
	const envelope: SecretsEnvelope = { version, mode, keys };
	if (mode === 'passphrase') {
		const kdf = parsed.kdf;
		if (isObject(kdf) && typeof kdf.iterations === 'number' && typeof kdf.salt === 'string') {
			envelope.kdf = { iterations: kdf.iterations, salt: kdf.salt };
		}
		if (typeof parsed.verifier === 'string') {
			envelope.verifier = parsed.verifier;
		}
		if (!envelope.kdf || !envelope.verifier) {
			// Malformed passphrase envelope; treat as fresh start.
			return defaultEnvelope();
		}
	}
	return envelope;
}

async function readEnvelopeFromDisk(plugin: Plugin): Promise<SecretsEnvelope> {
	const path = secretsPath(plugin);
	const exists = await plugin.app.vault.adapter.exists(path);
	if (!exists) return defaultEnvelope();
	try {
		const raw = await plugin.app.vault.adapter.read(path);
		return parseEnvelope(raw);
	} catch {
		return defaultEnvelope();
	}
}

async function ensureEnvelope(plugin: Plugin): Promise<SecretsEnvelope> {
	if (cachedEnvelope) return cachedEnvelope;
	cachedEnvelope = await readEnvelopeFromDisk(plugin);
	return cachedEnvelope;
}

async function writeEnvelope(plugin: Plugin, envelope: SecretsEnvelope): Promise<void> {
	const path = secretsPath(plugin);
	await plugin.app.vault.adapter.write(path, JSON.stringify(envelope));
	cachedEnvelope = envelope;
}

// ---------- base64 / buffer helpers ----------

function bytesToBase64(bytes: Uint8Array): string {
	let s = '';
	for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i] ?? 0);
	return btoa(s);
}

function base64ToBytes(b64: string): Uint8Array {
	const bin = atob(b64);
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	return bytes;
}

function base64ToNodeBuffer(b64: string): unknown {
	const Buf = (globalThis as unknown as { Buffer?: { from(s: string, enc: string): unknown } }).Buffer;
	if (Buf && typeof Buf.from === 'function') return Buf.from(b64, 'base64');
	return base64ToBytes(b64);
}

function randomBytes(n: number): Uint8Array {
	const out = new Uint8Array(n);
	crypto.getRandomValues(out);
	return out;
}

// ---------- WebCrypto passphrase helpers ----------

async function deriveKeyFromPassphrase(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
	const passBytes = new TextEncoder().encode(passphrase);
	const baseKey = await crypto.subtle.importKey(
		'raw',
		passBytes,
		{ name: 'PBKDF2' },
		false,
		['deriveKey'],
	);
	return crypto.subtle.deriveKey(
		{ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
		baseKey,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt', 'decrypt'],
	);
}

async function aesGcmEncrypt(key: CryptoKey, plaintext: string): Promise<string> {
	const iv = randomBytes(AES_IV_BYTES);
	const ct = await crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv: iv as BufferSource },
		key,
		new TextEncoder().encode(plaintext),
	);
	return `${bytesToBase64(iv)}${VALUE_SEP}${bytesToBase64(new Uint8Array(ct))}`;
}

async function aesGcmDecrypt(key: CryptoKey, payload: string): Promise<string> {
	const sepIdx = payload.indexOf(VALUE_SEP);
	if (sepIdx <= 0) throw new Error('Malformed encrypted value');
	const iv = base64ToBytes(payload.slice(0, sepIdx));
	const ct = base64ToBytes(payload.slice(sepIdx + 1));
	const pt = await crypto.subtle.decrypt(
		{ name: 'AES-GCM', iv: iv as BufferSource },
		key,
		ct as BufferSource,
	);
	return new TextDecoder().decode(pt);
}

// ---------- per-mode encrypt/decrypt of a single value ----------

async function encryptValue(envelope: SecretsEnvelope, plaintext: string): Promise<string> {
	if (envelope.mode === 'plaintext') return plaintext;
	if (envelope.mode === 'safeStorage') {
		const ss = getSafeStorage();
		if (!ss) throw new Error('safeStorage is unavailable on this device.');
		return ss.encryptString(plaintext).toString('base64');
	}
	if (envelope.mode === 'passphrase') {
		if (!unlockedKey) throw new Error('Secrets are locked. Unlock with your passphrase first.');
		return aesGcmEncrypt(unlockedKey, plaintext);
	}
	throw new Error(`Unknown encryption mode: ${envelope.mode as string}`);
}

async function decryptValue(envelope: SecretsEnvelope, stored: string): Promise<string> {
	if (stored === '') return '';
	if (envelope.mode === 'plaintext') return stored;
	if (envelope.mode === 'safeStorage') {
		const ss = getSafeStorage();
		if (!ss) return '';
		try {
			return ss.decryptString(base64ToNodeBuffer(stored));
		} catch {
			return '';
		}
	}
	if (envelope.mode === 'passphrase') {
		if (!unlockedKey) return '';
		try {
			return await aesGcmDecrypt(unlockedKey, stored);
		} catch {
			return '';
		}
	}
	return '';
}

// ---------- public API ----------

export async function getEncryptionStatus(plugin: Plugin): Promise<EncryptionStatus> {
	const envelope = await ensureEnvelope(plugin);
	return {
		mode: envelope.mode,
		locked: envelope.mode === 'passphrase' && unlockedKey === null,
		safeStorageAvailable: getSafeStorage() !== null,
		safeStorageBackend: getSafeStorageBackend(),
	};
}

export function isEncryptionAvailable(): boolean {
	return getSafeStorage() !== null;
}

export function lockSecrets(): void {
	unlockedKey = null;
}

export async function unlockSecrets(plugin: Plugin, passphrase: string): Promise<boolean> {
	const envelope = await ensureEnvelope(plugin);
	if (envelope.mode !== 'passphrase') return true;
	if (!envelope.kdf || !envelope.verifier) return false;
	const salt = base64ToBytes(envelope.kdf.salt);
	const candidate = await deriveKeyFromPassphrase(passphrase, salt, envelope.kdf.iterations);
	try {
		const decoded = await aesGcmDecrypt(candidate, envelope.verifier);
		if (decoded !== VERIFIER_PLAINTEXT) return false;
	} catch {
		return false;
	}
	unlockedKey = candidate;
	return true;
}

export async function saveKey(plugin: Plugin, id: string, key: string): Promise<void> {
	const envelope = await ensureEnvelope(plugin);
	if (envelope.mode === 'passphrase' && unlockedKey === null) {
		throw new Error('Secrets are locked. Unlock with your passphrase to save keys.');
	}
	if (key === '') {
		delete envelope.keys[id];
	} else {
		envelope.keys[id] = await encryptValue(envelope, key);
	}
	await writeEnvelope(plugin, envelope);
}

export async function saveManyKeys(plugin: Plugin, updates: Record<string, string>): Promise<void> {
	const envelope = await ensureEnvelope(plugin);
	if (envelope.mode === 'passphrase' && unlockedKey === null) {
		// Caller (settings save) may run while locked. Don't blow up; just skip writing
		// secrets so we don't clobber the on-disk encrypted values with empties.
		return;
	}
	for (const id of Object.keys(updates)) {
		const value = updates[id] ?? '';
		if (value === '') {
			delete envelope.keys[id];
		} else {
			envelope.keys[id] = await encryptValue(envelope, value);
		}
	}
	await writeEnvelope(plugin, envelope);
}

export async function loadKey(plugin: Plugin, id: string): Promise<string> {
	const envelope = await ensureEnvelope(plugin);
	const stored = envelope.keys[id];
	if (typeof stored !== 'string' || stored === '') return '';
	return decryptValue(envelope, stored);
}

export async function deleteKey(plugin: Plugin, id: string): Promise<void> {
	await saveKey(plugin, id, '');
}

export async function loadAllKeys(plugin: Plugin): Promise<Record<string, string>> {
	const envelope = await ensureEnvelope(plugin);
	const out: Record<string, string> = {};
	if (envelope.mode === 'passphrase' && unlockedKey === null) return out;
	for (const id of Object.keys(envelope.keys)) {
		const value = await decryptValue(envelope, envelope.keys[id] ?? '');
		if (value) out[id] = value;
	}
	return out;
}

// ---------- mode transitions ----------

export async function changeEncryptionMode(
	plugin: Plugin,
	newMode: EncryptionMode,
	newPassphrase?: string,
): Promise<void> {
	const envelope = await ensureEnvelope(plugin);
	if (envelope.mode === newMode && newMode !== 'passphrase') return;
	if (envelope.mode === 'passphrase' && unlockedKey === null) {
		throw new Error('Unlock secrets with the current passphrase before changing modes.');
	}
	if (newMode === 'safeStorage' && !getSafeStorage()) {
		throw new Error('OS keychain encryption is not available on this device.');
	}
	if (newMode === 'passphrase' && (!newPassphrase || newPassphrase.length === 0)) {
		throw new Error('A passphrase is required to switch to passphrase mode.');
	}

	const plain: Record<string, string> = {};
	for (const id of Object.keys(envelope.keys)) {
		const v = await decryptValue(envelope, envelope.keys[id] ?? '');
		if (v) plain[id] = v;
	}

	const next: SecretsEnvelope = {
		version: SECRETS_VERSION,
		mode: newMode,
		keys: {},
	};

	if (newMode === 'passphrase') {
		const salt = randomBytes(PBKDF2_SALT_BYTES);
		const newKey = await deriveKeyFromPassphrase(newPassphrase ?? '', salt, PBKDF2_ITERATIONS);
		next.kdf = { iterations: PBKDF2_ITERATIONS, salt: bytesToBase64(salt) };
		next.verifier = await aesGcmEncrypt(newKey, VERIFIER_PLAINTEXT);
		unlockedKey = newKey;
	} else {
		unlockedKey = null;
	}

	cachedEnvelope = next;
	for (const id of Object.keys(plain)) {
		next.keys[id] = await encryptValue(next, plain[id] ?? '');
	}
	await writeEnvelope(plugin, next);
}

export async function changePassphrase(plugin: Plugin, newPassphrase: string): Promise<void> {
	const envelope = await ensureEnvelope(plugin);
	if (envelope.mode !== 'passphrase') {
		throw new Error('Not in passphrase mode.');
	}
	if (unlockedKey === null) {
		throw new Error('Unlock with the current passphrase first.');
	}
	if (newPassphrase.length === 0) {
		throw new Error('Passphrase cannot be empty.');
	}
	await changeEncryptionMode(plugin, 'passphrase', newPassphrase);
}
