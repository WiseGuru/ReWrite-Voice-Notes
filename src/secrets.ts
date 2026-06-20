import { normalizePath, Plugin } from 'obsidian';
import { argon2id } from 'hash-wasm';
import { isPassphraseAcceptable } from 'passphrase-strength';

const SECRETS_FILE = 'secrets.json.nosync';
const SECRETS_VERSION = 2;
const VERIFIER_PLAINTEXT = 'rewrite-passphrase-verifier-v1';
const SECRET_STORAGE_SELFTEST = 'rewrite-secretstorage-selftest';
const SELFTEST_SECRET_ID = 'selftest';
const PBKDF2_ITERATIONS = 600_000;
const KDF_SALT_BYTES = 16;
const AES_IV_BYTES = 12;
const VALUE_SEP = '.';

// Argon2id parameters for new passphrase envelopes. Memory is capped at 32 MiB so
// the weakest supported phone (params live in the ciphertext and must reproduce on
// every device that opens the synced vault) can still allocate and unlock within the
// ~0.5-1s budget. Higher would risk allocation failure on low-RAM mobile webviews.
const ARGON2_MEM_KIB = 32_768; // 32 MiB
const ARGON2_TIME = 3;
const ARGON2_PARALLELISM = 1;
const ARGON2_HASH_BYTES = 32;

export type EncryptionMode = 'passphrase' | 'secretStorage';

export interface EncryptionStatus {
	mode: EncryptionMode;
	// passphrase mode with a derived key not yet held in memory this session.
	// Always false for secretStorage (Obsidian/the OS holds the key; nothing to unlock).
	locked: boolean;
	// passphrase mode that has actually had a passphrase set (kdf + verifier on disk).
	// false = first run on a device without secret storage: prompt to CREATE a passphrase.
	// Always true for secretStorage.
	configured: boolean;
	// Obsidian's app.secretStorage exists (>= 1.11.4) AND a round-trip self-test passes, so a
	// device with no working OS secret store (e.g. Linux without a keyring) reads false here.
	secretStorageAvailable: boolean;
	// The passphrase store has a complete kdf+verifier on disk, INDEPENDENT of the active mode.
	// Lets the UI tell a switch-to-passphrase (just activate) from a create-passphrase (prompt for
	// a new one), and whether a secretStorage-active user has a passphrase snapshot to copy.
	passphraseConfigured: boolean;
}

type KdfAlgo = 'pbkdf2' | 'argon2id';

interface PassphraseKdf {
	algo: KdfAlgo;
	salt: string; // base64
	// pbkdf2
	iterations?: number;
	// argon2id
	memKiB?: number;
	timeCost?: number;
	parallelism?: number;
}

interface SecretsEnvelope {
	version: number;
	mode: EncryptionMode;
	kdf?: PassphraseKdf;
	verifier?: string; // "<iv-b64>.<ct-b64>"
	keys: Record<string, string>;
}

// Obsidian's first-party secret store (app.secretStorage, GA 1.11.4). Reached through a narrow
// cast because the installed typings predate it, and normalized to these three methods. Each
// may be sync or async depending on the build, so callers await the results.
type MaybePromise<T> = T | Promise<T>;
interface SecretStorageLike {
	getSecret(id: string): MaybePromise<string | null>;
	setSecret(id: string, value: string): MaybePromise<void>;
	listSecrets(): MaybePromise<string[]>;
	deleteSecret(id: string): MaybePromise<void>;
}

// The raw shape as it may appear on app.secretStorage across builds: the documented class API
// is getSecret/setSecret/listSecrets, but some surfaces expose get/set/list aliases and a
// delete may or may not exist. getSecretStorage() resolves whatever is present.
interface RawSecretStorage {
	getSecret?: (id: string) => MaybePromise<string | null>;
	get?: (id: string) => MaybePromise<string | null>;
	setSecret?: (id: string, value: string) => MaybePromise<void>;
	set?: (id: string, value: string) => MaybePromise<void>;
	listSecrets?: () => MaybePromise<string[]>;
	list?: () => MaybePromise<string[]>;
	deleteSecret?: (id: string) => MaybePromise<void>;
	removeSecret?: (id: string) => MaybePromise<void>;
	delete?: (id: string) => MaybePromise<void>;
}

let secretStorageCache: SecretStorageLike | null | undefined;
// Cached result of the async availability self-test; read synchronously by defaultEnvelope.
let secretStorageAvailableCache: boolean | undefined;
let cachedEnvelope: SecretsEnvelope | null = null;
let unlockedKey: CryptoKey | null = null;

// ---------- Obsidian secret storage (app.secretStorage) ----------

// Prefix ids with the plugin id: app.secretStorage is shared across all installed plugins, so
// we namespace our keys to avoid colliding with another plugin's. The separator is a DASH, not a
// colon, because app.secretStorage.setSecret rejects any id that is not lowercase-alphanumeric +
// dashes (it throws on a colon/underscore/uppercase). manifest.id (`rewrite-voice-notes`) and all
// our secret ids are already dash-only, so the joined id stays valid; stripNs slices off this same
// fixed prefix to recover the original id.
function nsId(plugin: Plugin, id: string): string {
	return `${plugin.manifest.id}-${id}`;
}

function stripNs(plugin: Plugin, nsKey: string): string | null {
	const prefix = `${plugin.manifest.id}-`;
	return nsKey.startsWith(prefix) ? nsKey.slice(prefix.length) : null;
}

// Resolve app.secretStorage (if present) into the normalized three-method shape. Returns null
// on older Obsidian that lacks the API. Caches for the session. Only feature-detects that the
// methods exist; the deeper round-trip check is probeSecretStorage() below.
function getSecretStorage(plugin: Plugin): SecretStorageLike | null {
	if (secretStorageCache !== undefined) return secretStorageCache;
	const raw = (plugin.app as unknown as { secretStorage?: RawSecretStorage }).secretStorage;
	const get = raw?.getSecret ?? raw?.get;
	const set = raw?.setSecret ?? raw?.set;
	const list = raw?.listSecrets ?? raw?.list;
	if (!raw || typeof get !== 'function' || typeof set !== 'function' || typeof list !== 'function') {
		secretStorageCache = null;
		return null;
	}
	const del = raw.deleteSecret ?? raw.removeSecret ?? raw.delete;
	const normalized: SecretStorageLike = {
		getSecret: (id) => get.call(raw, id),
		setSecret: (id, value) => set.call(raw, id, value),
		listSecrets: () => list.call(raw),
		// No native delete on this build: clear by storing an empty string. The read paths
		// treat '' as absent, so a phantom empty entry is harmless.
		deleteSecret: typeof del === 'function' ? (id) => del.call(raw, id) : (id) => set.call(raw, id, ''),
	};
	secretStorageCache = normalized;
	return normalized;
}

// Round-trip self-test: write a sentinel, read it back, compare, clean up. A device whose OS
// secret store is missing or broken (e.g. Linux without a keyring) throws or returns a mismatch
// here, so we report unavailable and fall back to passphrase. Caches the result so the sync
// defaultEnvelope() can read availability after warmSecretStorage().
async function probeSecretStorage(plugin: Plugin): Promise<boolean> {
	if (secretStorageAvailableCache !== undefined) return secretStorageAvailableCache;
	const store = getSecretStorage(plugin);
	if (!store) {
		secretStorageAvailableCache = false;
		return false;
	}
	const id = nsId(plugin, SELFTEST_SECRET_ID);
	try {
		await store.setSecret(id, SECRET_STORAGE_SELFTEST);
		const got = await store.getSecret(id);
		await store.deleteSecret(id);
		secretStorageAvailableCache = got === SECRET_STORAGE_SELFTEST;
	} catch {
		secretStorageAvailableCache = false;
	}
	return secretStorageAvailableCache;
}

// Run the probe once and cache it so the synchronous defaultEnvelope() can prefer secret
// storage on first run. Called from main.ts onload before the first getEncryptionStatus.
export async function warmSecretStorage(plugin: Plugin): Promise<void> {
	await probeSecretStorage(plugin);
}

function secretStorageAvailableSync(): boolean {
	return secretStorageAvailableCache === true;
}

// Read every stored key from app.secretStorage to plaintext, stripping our namespace prefix
// and skipping the self-test sentinel. Empty values are treated as absent.
async function readAllFromSecretStorage(plugin: Plugin): Promise<Record<string, string>> {
	const store = getSecretStorage(plugin);
	if (!store) return {};
	let ids: string[];
	try {
		ids = await store.listSecrets();
	} catch {
		return {};
	}
	const out: Record<string, string> = {};
	for (const nsKey of ids) {
		const id = stripNs(plugin, nsKey);
		if (id === null || id === SELFTEST_SECRET_ID) continue;
		try {
			const v = await store.getSecret(nsKey);
			if (v) out[id] = v;
		} catch {
			// skip unreadable entry
		}
	}
	return out;
}

async function writeToSecretStorage(plugin: Plugin, id: string, value: string): Promise<void> {
	const store = getSecretStorage(plugin);
	if (!store) throw new Error('Obsidian secret storage is not available on this device.');
	if (value === '') {
		await store.deleteSecret(nsId(plugin, id));
	} else {
		await store.setSecret(nsId(plugin, id), value);
	}
}

// Remove all of our namespaced entries from app.secretStorage. Best-effort; used when switching
// away from secretStorage mode so keys do not linger in the shared (and possibly synced) store.
async function clearSecretStorage(plugin: Plugin): Promise<void> {
	const store = getSecretStorage(plugin);
	if (!store) return;
	let ids: string[];
	try {
		ids = await store.listSecrets();
	} catch {
		return;
	}
	for (const nsKey of ids) {
		if (stripNs(plugin, nsKey) === null) continue;
		try {
			await store.deleteSecret(nsKey);
		} catch {
			// best-effort cleanup
		}
	}
}

function secretsPath(plugin: Plugin): string {
	const dir = plugin.manifest.dir;
	if (!dir) throw new Error('Plugin manifest.dir is missing');
	return normalizePath(`${dir}/${SECRETS_FILE}`);
}

function defaultEnvelope(): SecretsEnvelope {
	// Prefer Obsidian secret storage when available (warmed at onload). Otherwise passphrase
	// mode, but UNCONFIGURED (no kdf/verifier): the first pipeline use / settings visit prompts
	// the user to create a passphrase. Nothing is written in that state (saveManyKeys no-ops
	// while locked).
	return {
		version: SECRETS_VERSION,
		mode: secretStorageAvailableSync() ? 'secretStorage' : 'passphrase',
		keys: {},
	};
}

function isObject(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseKdf(raw: unknown): PassphraseKdf | undefined {
	if (!isObject(raw) || typeof raw.salt !== 'string') return undefined;
	if (raw.algo === 'argon2id') {
		return {
			algo: 'argon2id',
			salt: raw.salt,
			memKiB: typeof raw.memKiB === 'number' ? raw.memKiB : ARGON2_MEM_KIB,
			timeCost: typeof raw.timeCost === 'number' ? raw.timeCost : ARGON2_TIME,
			parallelism: typeof raw.parallelism === 'number' ? raw.parallelism : ARGON2_PARALLELISM,
		};
	}
	// 'pbkdf2' or a legacy envelope with no algo field but an iterations count.
	if (typeof raw.iterations === 'number') {
		return { algo: 'pbkdf2', salt: raw.salt, iterations: raw.iterations };
	}
	return undefined;
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
		// Pre-release: no migrations. Treat unknown shapes (incl. old 'plaintext'
		// envelopes that fail the mode check below) as a fresh start.
		return defaultEnvelope();
	}
	const mode = parsed.mode;
	if (mode !== 'passphrase' && mode !== 'secretStorage') {
		return defaultEnvelope();
	}
	const keys = isObject(parsed.keys) ? parsed.keys as Record<string, string> : {};
	const envelope: SecretsEnvelope = { version, mode, keys };
	// Retain passphrase material (kdf/verifier/keys) whenever present, REGARDLESS of the active
	// mode. The two stores coexist: when secretStorage is active, the passphrase kdf/verifier/keys
	// are a preserved-at-rest snapshot (active keys live in the OS store). Only a complete
	// kdf+verifier pair counts as a configured passphrase store.
	const kdf = parseKdf(parsed.kdf);
	const verifier = typeof parsed.verifier === 'string' ? parsed.verifier : undefined;
	if (kdf && verifier) {
		envelope.kdf = kdf;
		envelope.verifier = verifier;
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

function randomBytes(n: number): Uint8Array {
	const out = new Uint8Array(n);
	crypto.getRandomValues(out);
	return out;
}

// Heuristic: did an Argon2 derivation fail because the device couldn't allocate the
// requested memory (or run wasm at all)? Used to fall back to PBKDF2 at creation and
// to give a clear message at unlock.
function isAllocationFailure(e: unknown): boolean {
	if (e instanceof RangeError) return true;
	const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
	return msg.includes('memory') || msg.includes('alloc') || msg.includes('wasm') || msg.includes('webassembly');
}

// ---------- key derivation ----------

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

async function deriveArgon2idKey(
	passphrase: string,
	salt: Uint8Array,
	memKiB: number,
	timeCost: number,
	parallelism: number,
): Promise<CryptoKey> {
	const raw = await argon2id({
		password: passphrase,
		salt,
		parallelism,
		iterations: timeCost,
		memorySize: memKiB,
		hashLength: ARGON2_HASH_BYTES,
		outputType: 'binary',
	});
	return crypto.subtle.importKey(
		'raw',
		raw as BufferSource,
		{ name: 'AES-GCM' },
		false,
		['encrypt', 'decrypt'],
	);
}

async function deriveKeyFromKdf(passphrase: string, kdf: PassphraseKdf): Promise<CryptoKey> {
	const salt = base64ToBytes(kdf.salt);
	if (kdf.algo === 'argon2id') {
		return deriveArgon2idKey(
			passphrase,
			salt,
			kdf.memKiB ?? ARGON2_MEM_KIB,
			kdf.timeCost ?? ARGON2_TIME,
			kdf.parallelism ?? ARGON2_PARALLELISM,
		);
	}
	return deriveKeyFromPassphrase(passphrase, salt, kdf.iterations ?? PBKDF2_ITERATIONS);
}

// Build a fresh kdf + derived key for a new passphrase. Prefers Argon2id; on any
// derivation failure (wasm unavailable / can't allocate memory) falls back to PBKDF2
// so a constrained device can still set a passphrase.
async function buildPassphraseKdfAndKey(passphrase: string): Promise<{ kdf: PassphraseKdf; key: CryptoKey }> {
	const salt = randomBytes(KDF_SALT_BYTES);
	try {
		const key = await deriveArgon2idKey(passphrase, salt, ARGON2_MEM_KIB, ARGON2_TIME, ARGON2_PARALLELISM);
		return {
			kdf: {
				algo: 'argon2id',
				salt: bytesToBase64(salt),
				memKiB: ARGON2_MEM_KIB,
				timeCost: ARGON2_TIME,
				parallelism: ARGON2_PARALLELISM,
			},
			key,
		};
	} catch {
		const key = await deriveKeyFromPassphrase(passphrase, salt, PBKDF2_ITERATIONS);
		return {
			kdf: { algo: 'pbkdf2', salt: bytesToBase64(salt), iterations: PBKDF2_ITERATIONS },
			key,
		};
	}
}

// ---------- AES-GCM value codec ----------

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

// Encrypt/decrypt a single value for the passphrase envelope. secretStorage mode never calls
// these; it routes values straight to app.secretStorage.
async function encryptValue(plaintext: string): Promise<string> {
	if (!unlockedKey) throw new Error('Secrets are locked. Unlock with your passphrase first.');
	return aesGcmEncrypt(unlockedKey, plaintext);
}

async function decryptValue(stored: string): Promise<string> {
	if (stored === '') return '';
	if (!unlockedKey) return '';
	try {
		return await aesGcmDecrypt(unlockedKey, stored);
	} catch {
		return '';
	}
}

async function decryptAllToPlain(envelope: SecretsEnvelope): Promise<Record<string, string>> {
	const plain: Record<string, string> = {};
	for (const id of Object.keys(envelope.keys)) {
		const v = await decryptValue(envelope.keys[id] ?? '');
		if (v) plain[id] = v;
	}
	return plain;
}

// Write a freshly-built passphrase envelope (kdf + verifier) and re-encrypt `plain`
// under the new key. Sets unlockedKey. Used by mode change, change-passphrase, and
// the unlock-time KDF upgrade. Does NOT enforce entropy (the caller does, when needed).
async function writePassphraseEnvelope(
	plugin: Plugin,
	passphrase: string,
	plain: Record<string, string>,
): Promise<void> {
	const { kdf, key } = await buildPassphraseKdfAndKey(passphrase);
	unlockedKey = key;
	const next: SecretsEnvelope = { version: SECRETS_VERSION, mode: 'passphrase', kdf, keys: {} };
	next.verifier = await aesGcmEncrypt(key, VERIFIER_PLAINTEXT);
	cachedEnvelope = next;
	for (const id of Object.keys(plain)) {
		next.keys[id] = await encryptValue(plain[id] ?? '');
	}
	await writeEnvelope(plugin, next);
}

// Best-effort upgrade of a legacy PBKDF2 envelope to Argon2id on unlock. Requires the
// current (pbkdf2) key already in unlockedKey so we can read the stored values. If the
// device can't run Argon2id, leaves the envelope on PBKDF2.
async function tryUpgradeToArgon2id(plugin: Plugin, passphrase: string): Promise<void> {
	const envelope = await ensureEnvelope(plugin);
	if (envelope.mode !== 'passphrase' || envelope.kdf?.algo !== 'pbkdf2') return;
	const plain = await decryptAllToPlain(envelope);
	const built = await buildPassphraseKdfAndKey(passphrase);
	if (built.kdf.algo !== 'argon2id') return; // device can't do Argon2id; keep PBKDF2
	unlockedKey = built.key;
	const next: SecretsEnvelope = { version: SECRETS_VERSION, mode: 'passphrase', kdf: built.kdf, keys: {} };
	next.verifier = await aesGcmEncrypt(built.key, VERIFIER_PLAINTEXT);
	cachedEnvelope = next;
	for (const id of Object.keys(plain)) {
		next.keys[id] = await encryptValue(plain[id] ?? '');
	}
	await writeEnvelope(plugin, next);
}

// ---------- public API ----------

export async function getEncryptionStatus(plugin: Plugin): Promise<EncryptionStatus> {
	const envelope = await ensureEnvelope(plugin);
	const passphraseConfigured = envelope.kdf != null && envelope.verifier != null;
	return {
		mode: envelope.mode,
		locked: envelope.mode === 'passphrase' && unlockedKey === null,
		configured: envelope.mode !== 'passphrase' || passphraseConfigured,
		secretStorageAvailable: await probeSecretStorage(plugin),
		passphraseConfigured,
	};
}

export function lockSecrets(): void {
	unlockedKey = null;
}

// Derive + verify the passphrase store's key from the on-disk envelope, REGARDLESS of which
// mode is active, and cache it in unlockedKey. This lets a secretStorage-active user unlock the
// passphrase snapshot in order to copy it. Returns false on an unconfigured store or a wrong
// passphrase; throws a clear message on an Argon2id allocation failure.
export async function unlockPassphraseStore(plugin: Plugin, passphrase: string): Promise<boolean> {
	const envelope = await ensureEnvelope(plugin);
	if (!envelope.kdf || !envelope.verifier) return false;
	let candidate: CryptoKey;
	try {
		candidate = await deriveKeyFromKdf(passphrase, envelope.kdf);
	} catch (e) {
		if (envelope.kdf.algo === 'argon2id' && isAllocationFailure(e)) {
			const mib = Math.round((envelope.kdf.memKiB ?? ARGON2_MEM_KIB) / 1024);
			throw new Error(
				`This device can't allocate the ~${mib} MiB needed to unlock. These secrets were encrypted with Argon2id on a device with more memory.`,
			);
		}
		return false;
	}
	try {
		const decoded = await aesGcmDecrypt(candidate, envelope.verifier);
		if (decoded !== VERIFIER_PLAINTEXT) return false;
	} catch {
		return false;
	}
	unlockedKey = candidate;
	// Opportunistically migrate legacy PBKDF2 envelopes to Argon2id while we hold the passphrase.
	// Only when passphrase is the ACTIVE store (tryUpgradeToArgon2id rewrites a passphrase
	// envelope, which would clobber an active secretStorage envelope's mode). Best-effort.
	if (envelope.mode === 'passphrase' && envelope.kdf.algo === 'pbkdf2') {
		try {
			await tryUpgradeToArgon2id(plugin, passphrase);
		} catch {
			// keep PBKDF2; nothing to do
		}
	}
	return true;
}

export async function unlockSecrets(plugin: Plugin, passphrase: string): Promise<boolean> {
	const envelope = await ensureEnvelope(plugin);
	if (envelope.mode !== 'passphrase') return true;
	return unlockPassphraseStore(plugin, passphrase);
}

export async function saveKey(plugin: Plugin, id: string, key: string): Promise<void> {
	const envelope = await ensureEnvelope(plugin);
	if (envelope.mode === 'secretStorage') {
		await writeToSecretStorage(plugin, id, key);
		return;
	}
	if (unlockedKey === null) {
		throw new Error('Secrets are locked. Unlock with your passphrase to save keys.');
	}
	if (key === '') {
		delete envelope.keys[id];
	} else {
		envelope.keys[id] = await encryptValue(key);
	}
	await writeEnvelope(plugin, envelope);
}

export async function saveManyKeys(plugin: Plugin, updates: Record<string, string>): Promise<void> {
	const envelope = await ensureEnvelope(plugin);
	if (envelope.mode === 'secretStorage') {
		for (const id of Object.keys(updates)) {
			await writeToSecretStorage(plugin, id, updates[id] ?? '');
		}
		return;
	}
	if (unlockedKey === null) {
		// Caller (settings save) may run while locked or unconfigured. Don't blow up;
		// just skip writing so we don't clobber on-disk encrypted values with empties.
		return;
	}
	for (const id of Object.keys(updates)) {
		const value = updates[id] ?? '';
		if (value === '') {
			delete envelope.keys[id];
		} else {
			envelope.keys[id] = await encryptValue(value);
		}
	}
	await writeEnvelope(plugin, envelope);
}

export async function loadKey(plugin: Plugin, id: string): Promise<string> {
	const envelope = await ensureEnvelope(plugin);
	if (envelope.mode === 'secretStorage') {
		const store = getSecretStorage(plugin);
		if (!store) return '';
		try {
			return (await store.getSecret(nsId(plugin, id))) ?? '';
		} catch {
			return '';
		}
	}
	const stored = envelope.keys[id];
	if (typeof stored !== 'string' || stored === '') return '';
	return decryptValue(stored);
}

export async function deleteKey(plugin: Plugin, id: string): Promise<void> {
	await saveKey(plugin, id, '');
}

export async function loadAllKeys(plugin: Plugin): Promise<Record<string, string>> {
	const envelope = await ensureEnvelope(plugin);
	if (envelope.mode === 'secretStorage') return readAllFromSecretStorage(plugin);
	if (unlockedKey === null) return {};
	return decryptAllToPlain(envelope);
}

// ---------- mode switch / copy / clear ----------

// Count the keys stored under a method, without decrypting (passphrase) or transferring. Drives
// the settings UI (whether Migrate has a source, how many keys Clear will wipe).
export async function countStoredKeys(plugin: Plugin, mode: EncryptionMode): Promise<number> {
	if (mode === 'secretStorage') {
		return Object.keys(await readAllFromSecretStorage(plugin)).length;
	}
	const envelope = await ensureEnvelope(plugin);
	return Object.values(envelope.keys).filter((v) => typeof v === 'string' && v !== '').length;
}

// Switch the ACTIVE encryption method WITHOUT transferring any keys. Keys saved under the other
// method are preserved at rest (passphrase kdf/verifier/keys stay in the envelope; secretStorage
// entries stay in the OS store). Use copyKeys() to copy them over.
export async function setEncryptionMode(
	plugin: Plugin,
	newMode: EncryptionMode,
	newPassphrase?: string,
): Promise<void> {
	const envelope = await ensureEnvelope(plugin);
	if (envelope.mode === newMode) return;

	if (newMode === 'secretStorage') {
		if (!(await probeSecretStorage(plugin))) {
			throw new Error('Obsidian secret storage is not available on this device.');
		}
		// Flip the active mode; keep kdf/verifier/keys (the now-inactive passphrase snapshot) and
		// the in-memory unlockedKey so a later passphrase->secretStorage copy needs no re-prompt.
		await writeEnvelope(plugin, { ...envelope, version: SECRETS_VERSION, mode: 'secretStorage' });
		return;
	}

	// newMode === 'passphrase'
	if (envelope.kdf && envelope.verifier) {
		// Passphrase store already configured: just make it active. It is locked until the user
		// unlocks (unless unlockedKey is still held from this session). No rebuild, no transfer.
		await writeEnvelope(plugin, { ...envelope, version: SECRETS_VERSION, mode: 'passphrase' });
		return;
	}

	// Passphrase store not configured yet: a new passphrase is required to create it.
	if (!newPassphrase || newPassphrase.length === 0) {
		throw new Error('A passphrase is required to switch to passphrase mode.');
	}
	if (!(await isPassphraseAcceptable(newPassphrase))) {
		throw new Error('Passphrase is too weak. Use a longer, more unique passphrase (try the Generate button).');
	}
	// Build a fresh, empty passphrase envelope (becomes the active mode). Any secretStorage keys
	// stay untouched in the OS store; the user can copy them in afterwards.
	await writePassphraseEnvelope(plugin, newPassphrase, {});
}

// Copy keys FROM the inactive method INTO the currently active method. The source is NOT deleted
// (use clearKeys for that), so this is a copy, not a move. Same-named ids in the target are
// overwritten; other target ids are left intact. Returns the number of keys written. The caller
// must have unlocked the passphrase store first whenever passphrase is the source or target
// (encrypt/decrypt needs unlockedKey).
export async function copyKeys(plugin: Plugin): Promise<number> {
	const envelope = await ensureEnvelope(plugin);
	const source: EncryptionMode = envelope.mode === 'secretStorage' ? 'passphrase' : 'secretStorage';

	let sourcePlain: Record<string, string>;
	if (source === 'secretStorage') {
		sourcePlain = await readAllFromSecretStorage(plugin);
	} else {
		if (!envelope.kdf || !envelope.verifier) return 0; // no passphrase store to copy from
		if (unlockedKey === null) {
			throw new Error('Unlock the passphrase store before copying its keys.');
		}
		sourcePlain = await decryptAllToPlain(envelope);
	}

	const ids = Object.keys(sourcePlain).filter((id) => sourcePlain[id]);
	if (ids.length === 0) return 0;

	if (envelope.mode === 'secretStorage') {
		for (const id of ids) {
			await writeToSecretStorage(plugin, id, sourcePlain[id] ?? '');
		}
	} else {
		if (unlockedKey === null) {
			throw new Error('Unlock the passphrase store before copying keys into it.');
		}
		for (const id of ids) {
			envelope.keys[id] = await encryptValue(sourcePlain[id] ?? '');
		}
		await writeEnvelope(plugin, envelope);
	}
	return ids.length;
}

// Permanently delete every key saved under a method. secretStorage: remove our namespaced OS
// entries. passphrase: drop kdf/verifier/keys from the envelope (rendering it unconfigured) and
// forget the in-memory key. Does not change the active mode.
export async function clearKeys(plugin: Plugin, mode: EncryptionMode): Promise<void> {
	const envelope = await ensureEnvelope(plugin);
	if (mode === 'secretStorage') {
		await clearSecretStorage(plugin);
		return;
	}
	// passphrase: strip all passphrase material, keep the active mode flag as-is.
	unlockedKey = null;
	await writeEnvelope(plugin, { version: SECRETS_VERSION, mode: envelope.mode, keys: {} });
}

// Forgot-passphrase recovery. Discards all existing key material (the old keys are
// unrecoverable without the old passphrase) and writes a fresh, empty passphrase envelope
// under a new passphrase. Unlike changePassphrase, this does NOT require unlocking first.
export async function resetSecrets(plugin: Plugin, newPassphrase: string): Promise<void> {
	if (newPassphrase.length === 0) {
		throw new Error('A passphrase is required.');
	}
	if (!(await isPassphraseAcceptable(newPassphrase))) {
		throw new Error('Passphrase is too weak. Use a longer, more unique passphrase (try the Generate button).');
	}
	// The old passphrase is forgotten, so the old keys are gone for good. Drop any cached
	// state and write a fresh, empty passphrase envelope under the new key.
	unlockedKey = null;
	cachedEnvelope = null;
	await writePassphraseEnvelope(plugin, newPassphrase, {});
}

// Re-encrypt the existing passphrase keys under a new passphrase (a within-passphrase re-key, not
// a cross-mode transfer). Requires passphrase to be the active mode and currently unlocked.
export async function changePassphrase(plugin: Plugin, newPassphrase: string): Promise<void> {
	const envelope = await ensureEnvelope(plugin);
	if (envelope.mode !== 'passphrase') {
		throw new Error('Not in passphrase mode.');
	}
	if (unlockedKey === null && envelope.kdf) {
		throw new Error('Unlock with the current passphrase first.');
	}
	if (newPassphrase.length === 0) {
		throw new Error('Passphrase cannot be empty.');
	}
	if (!(await isPassphraseAcceptable(newPassphrase))) {
		throw new Error('Passphrase is too weak. Use a longer, more unique passphrase (try the Generate button).');
	}
	const plain = await decryptAllToPlain(envelope);
	await writePassphraseEnvelope(plugin, newPassphrase, plain);
}
