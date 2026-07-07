import { normalizePath, Platform, Plugin } from 'obsidian';
import { LocalWhisperSettings } from './types';

export type WhisperStatus = 'stopped' | 'starting' | 'running' | 'external' | 'crashed';
export type WhisperOwnership = 'spawned' | 'adopted' | 'external';

export interface WhisperSnapshot {
	status: WhisperStatus;
	baseUrl: string | null;
	ownership: WhisperOwnership | null;
	pid: number | null;
}

const PID_FILE = 'whisper-host.pid.json';

interface PidFileContents {
	pid: number;
	port: number;
	binaryPath: string;
	startedAt: number;
}

interface SpawnedChild {
	pid?: number;
	stdout: { on(event: 'data', cb: (chunk: { toString(): string }) => void): void } | null;
	stderr: { on(event: 'data', cb: (chunk: { toString(): string }) => void): void } | null;
	on(event: 'exit', cb: (code: number | null, signal: string | null) => void): void;
	once(event: 'exit', cb: (code: number | null, signal: string | null) => void): void;
	kill(signal?: string): boolean;
}

interface ChildProcessAPI {
	spawn(
		command: string,
		args: string[],
		options: { stdio: Array<'ignore' | 'pipe'> },
	): SpawnedChild;
}

interface NetSocket {
	on(event: 'error' | 'connect', cb: () => void): void;
	once(event: 'error' | 'connect', cb: () => void): void;
	end(): void;
	destroy(): void;
}

interface NetServer {
	once(event: 'error' | 'listening', cb: (err?: Error) => void): void;
	close(cb?: () => void): void;
	listen(port: number, host: string): void;
}

interface NetAPI {
	createServer(): NetServer;
	createConnection(opts: { host: string; port: number }): NetSocket;
}

interface FsAPI {
	existsSync(path: string): boolean;
}

interface ProcessAPI {
	kill(pid: number, signal?: number | string): void;
}

interface NodeAPI {
	cp: ChildProcessAPI;
	net: NetAPI;
	fs: FsAPI;
	process: ProcessAPI;
}

let nodeApiCache: NodeAPI | null | undefined;

function getNodeApi(): NodeAPI | null {
	if (nodeApiCache !== undefined) return nodeApiCache;
	if (!Platform.isDesktop) {
		nodeApiCache = null;
		return null;
	}
	try {
		const req = (window as unknown as { require?: (m: string) => unknown }).require;
		if (typeof req !== 'function') {
			nodeApiCache = null;
			return null;
		}
		const cp = req('child_process') as ChildProcessAPI;
		const net = req('net') as NetAPI;
		const fs = req('fs') as FsAPI;
		const proc = (window as unknown as { process?: ProcessAPI }).process;
		if (!proc || typeof proc.kill !== 'function') {
			nodeApiCache = null;
			return null;
		}
		nodeApiCache = { cp, net, fs, process: proc };
		return nodeApiCache;
	} catch {
		nodeApiCache = null;
		return null;
	}
}

export function formatWhisperStatus(snap: WhisperSnapshot): string {
	switch (snap.status) {
		case 'stopped':
			return 'Stopped.';
		case 'starting':
			return 'Starting...';
		case 'running': {
			const where = snap.baseUrl ? ` on ${snap.baseUrl}` : '';
			if (snap.ownership === 'adopted' && snap.pid !== null) {
				return `Running${where} (adopted from previous session, pid ${snap.pid}).`;
			}
			if (snap.pid !== null) {
				return `Running${where} (ReWrite, pid ${snap.pid}).`;
			}
			return `Running${where}.`;
		}
		case 'external': {
			const where = snap.baseUrl ? ` on ${snap.baseUrl}` : '';
			return `External whisper-server${where} (not started by ReWrite).`;
		}
		case 'crashed':
			return 'Crashed. See log for details.';
	}
}

const MAX_LOG_BYTES = 1_000_000;
const READY_TIMEOUT_MS = 5_000;
const READY_POLL_MS = 250;
const STOP_KILL_GRACE_MS = 3_000;

export class WhisperHost {
	private statusValue: WhisperStatus = 'stopped';
	private child: SpawnedChild | null = null;
	private currentPort: number | null = null;
	private currentPid: number | null = null;
	private ownershipValue: WhisperOwnership | null = null;
	private logBuffer = '';
	private stoppingDeliberately = false;

	constructor(private plugin: Plugin) {}

	status(): WhisperStatus {
		return this.statusValue;
	}

	baseUrl(): string | null {
		if (this.currentPort === null) return null;
		if (this.statusValue !== 'running' && this.statusValue !== 'external') return null;
		return `http://127.0.0.1:${this.currentPort}`;
	}

	ownership(): WhisperOwnership | null {
		return this.ownershipValue;
	}

	pid(): number | null {
		return this.currentPid;
	}

	snapshot(): WhisperSnapshot {
		return {
			status: this.statusValue,
			baseUrl: this.baseUrl(),
			ownership: this.ownershipValue,
			pid: this.currentPid,
		};
	}

	getLog(): string {
		return this.logBuffer;
	}

	async start(config: LocalWhisperSettings): Promise<void> {
		if (this.statusValue === 'running' || this.statusValue === 'starting') {
			return;
		}
		const api = getNodeApi();
		if (!api) {
			throw new Error('Local whisper.cpp server requires desktop Obsidian.');
		}
		if (!config.binaryPath) throw new Error('Binary path is not configured.');
		if (!config.modelPath) throw new Error('Model path is not configured.');
		if (!api.fs.existsSync(config.binaryPath)) {
			throw new Error(`Binary not found: ${config.binaryPath}`);
		}
		if (!api.fs.existsSync(config.modelPath)) {
			throw new Error(`Model not found: ${config.modelPath}`);
		}
		const port = resolvePort(config);
		// Discover any existing server on the configured port before spawning.
		const probed = await this.probe(config);
		if (probed.status === 'running') {
			// Adopted an orphan from a previous session; nothing to start.
			return;
		}
		if (probed.status === 'external') {
			throw new Error(`Port ${port} is bound by an external whisper-server (not started by ReWrite). Stop it via OS tools before starting one here.`);
		}
		if (await isPortInUse(api.net, port)) {
			throw new Error(`Port ${port} is already in use. Another process may be bound to it; check Activity Monitor or Task Manager.`);
		}

		this.statusValue = 'starting';
		this.logBuffer = '';
		this.stoppingDeliberately = false;

		const extra = splitArgs(config.extraArgs);
		// The whisper.cpp server has no authentication or TLS. Refuse to bind it
		// to anything other than loopback so a stray --host in Extra args cannot
		// silently expose an open transcription service to the LAN, and pin
		// 127.0.0.1 ourselves when the user did not specify a host (so we don't
		// rely on upstream's default binding staying loopback).
		const hostArgs = getHostArgs(extra);
		const badHost = hostArgs.find((h) => !isLoopbackHost(h));
		if (badHost !== undefined) {
			throw new Error(`Refusing to start: --host ${badHost || '(empty)'} would bind whisper-server to a non-loopback interface, exposing an unauthenticated transcription server to your network. Remove it from Extra args; ReWrite always binds 127.0.0.1.`);
		}
		const args = [
			'-m', config.modelPath,
			'--port', String(port),
			...(hostArgs.length === 0 ? ['--host', '127.0.0.1'] : []),
			...extra,
		];
		const child = api.cp.spawn(config.binaryPath, args, {
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		this.child = child;
		this.currentPort = port;
		this.currentPid = child.pid ?? null;
		this.ownershipValue = 'spawned';

		const append = (s: string): void => {
			this.logBuffer += s;
			if (this.logBuffer.length > MAX_LOG_BYTES) {
				this.logBuffer = this.logBuffer.slice(-MAX_LOG_BYTES);
			}
		};
		child.stdout?.on('data', (d) => append(d.toString()));
		child.stderr?.on('data', (d) => append(d.toString()));
		child.on('exit', (code, signal) => {
			append(`\n[process exited code=${code ?? 'null'} signal=${signal ?? 'null'}]\n`);
			if (this.child === child) {
				this.child = null;
				this.currentPid = null;
				this.ownershipValue = null;
				if (!this.stoppingDeliberately) {
					this.statusValue = 'crashed';
				}
				void this.clearPidFile();
			}
		});

		const deadline = Date.now() + READY_TIMEOUT_MS;
		while (Date.now() < deadline) {
			if (!this.child) {
				const tail = this.logBuffer.slice(-500);
				this.statusValue = 'crashed';
				throw new Error(`whisper-server exited during startup. Log tail: ${tail || '(empty)'}`);
			}
			if (await isPortReachable(api.net, port)) {
				this.statusValue = 'running';
				if (child.pid !== undefined) {
					await this.writePidFile({
						pid: child.pid,
						port,
						binaryPath: config.binaryPath,
						startedAt: Date.now(),
					});
				}
				return;
			}
			await delay(READY_POLL_MS);
		}

		this.stoppingDeliberately = true;
		try { child.kill(); } catch { /* best effort */ }
		this.child = null;
		this.currentPort = null;
		this.currentPid = null;
		this.ownershipValue = null;
		this.statusValue = 'crashed';
		const tail = this.logBuffer.slice(-500);
		throw new Error(`whisper-server did not become ready within ${READY_TIMEOUT_MS / 1000}s. Log tail: ${tail || '(empty)'}`);
	}

	async stop(): Promise<void> {
		if (this.statusValue === 'external') {
			throw new Error('This whisper-server was not started by ReWrite. Stop the process from your task manager.');
		}
		const child = this.child;
		if (child) {
			this.stoppingDeliberately = true;
			this.statusValue = 'stopped';
			this.child = null;
			this.currentPort = null;
			this.currentPid = null;
			this.ownershipValue = null;

			await new Promise<void>((resolve) => {
				let settled = false;
				const killTimer = window.setTimeout(() => {
					try { child.kill('SIGKILL'); } catch { /* best effort */ }
					finish();
				}, STOP_KILL_GRACE_MS);
				const finish = (): void => {
					if (settled) return;
					settled = true;
					window.clearTimeout(killTimer);
					resolve();
				};
				child.once('exit', finish);
				try { child.kill(); } catch { /* best effort */ }
			});
			await this.clearPidFile();
			return;
		}
		// Adopted (no live child handle) or stopped: kill via PID if we have one. The sidecar's
		// PID could have been recycled by the OS for an unrelated process since we adopted it
		// (e.g. after an OS crash), so re-verify the port is still bound to *something* right
		// before killing by PID: if it isn't, whatever we adopted is already gone, and sending a
		// signal to the stale PID would risk hitting a process that has nothing to do with it.
		// This narrows, but does not eliminate, the PID-reuse window (a full port-plus-PID
		// collision is far less likely than a bare PID collision).
		const api = getNodeApi();
		const pid = this.currentPid;
		const port = this.currentPort;
		if (pid !== null && api && port !== null && !(await isPortReachable(api.net, port))) {
			this.statusValue = 'stopped';
			this.currentPort = null;
			this.currentPid = null;
			this.ownershipValue = null;
			await this.clearPidFile();
			return;
		}
		if (pid !== null && api) {
			this.stoppingDeliberately = true;
			this.statusValue = 'stopped';
			this.currentPort = null;
			this.currentPid = null;
			this.ownershipValue = null;
			try { api.process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
			const deadline = Date.now() + STOP_KILL_GRACE_MS;
			while (Date.now() < deadline) {
				if (!isPidAlive(api.process, pid)) break;
				await delay(100);
			}
			if (isPidAlive(api.process, pid)) {
				try { api.process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
			}
		} else {
			this.statusValue = 'stopped';
			this.currentPort = null;
			this.currentPid = null;
			this.ownershipValue = null;
		}
		await this.clearPidFile();
	}

	// Probe the configured port to detect existing servers (adopt our own
	// orphans, observe external ones). Safe to call any time. Will not
	// disturb state when we already hold a live spawned child.
	async probe(config: LocalWhisperSettings): Promise<WhisperSnapshot> {
		const api = getNodeApi();
		if (!api) return this.snapshot();
		// If we already own a spawned child, leave state alone.
		if (this.child && this.statusValue === 'running') return this.snapshot();
		const port = resolvePort(config);
		const reachable = await isPortReachable(api.net, port);
		if (!reachable) {
			// Nothing bound. Clear any stale sidecar and reset to stopped if we
			// were tracking an external/adopted server that has since gone away.
			await this.clearPidFile();
			if (this.statusValue === 'external' || (this.statusValue === 'running' && this.ownershipValue === 'adopted')) {
				this.statusValue = 'stopped';
				this.currentPort = null;
				this.currentPid = null;
				this.ownershipValue = null;
			}
			return this.snapshot();
		}
		// Port is bound. Check the sidecar for ownership.
		const record = await this.readPidFile();
		const ownedByUs = record !== null
			&& record.port === port
			&& isPidAlive(api.process, record.pid);
		if (ownedByUs && record) {
			this.statusValue = 'running';
			this.ownershipValue = 'adopted';
			this.currentPort = port;
			this.currentPid = record.pid;
			return this.snapshot();
		}
		// Bound by someone else. Clear stale sidecar if present.
		if (record) await this.clearPidFile();
		this.statusValue = 'external';
		this.ownershipValue = 'external';
		this.currentPort = port;
		this.currentPid = null;
		return this.snapshot();
	}

	private pidFilePath(): string {
		const dir = this.plugin.manifest.dir;
		if (!dir) throw new Error('Plugin manifest.dir is missing');
		return normalizePath(`${dir}/${PID_FILE}`);
	}

	private async writePidFile(contents: PidFileContents): Promise<void> {
		try {
			await this.plugin.app.vault.adapter.write(this.pidFilePath(), JSON.stringify(contents));
		} catch {
			// best effort; recovery just won't fire next session
		}
	}

	private async readPidFile(): Promise<PidFileContents | null> {
		const path = this.pidFilePath();
		try {
			if (!(await this.plugin.app.vault.adapter.exists(path))) return null;
			const raw = await this.plugin.app.vault.adapter.read(path);
			const parsed = JSON.parse(raw) as Partial<PidFileContents>;
			if (
				typeof parsed.pid === 'number'
				&& typeof parsed.port === 'number'
				&& typeof parsed.binaryPath === 'string'
				&& typeof parsed.startedAt === 'number'
			) {
				return parsed as PidFileContents;
			}
			return null;
		} catch {
			return null;
		}
	}

	private async clearPidFile(): Promise<void> {
		try {
			const path = this.pidFilePath();
			if (await this.plugin.app.vault.adapter.exists(path)) {
				await this.plugin.app.vault.adapter.remove(path);
			}
		} catch {
			// best effort
		}
	}
}

// A port above 65535 previously fell through to the ready-timeout path with a confusing "did not
// become ready" error rather than a clear validation message.
function resolvePort(config: LocalWhisperSettings): number {
	return Number.isFinite(config.port) && config.port > 0 && config.port <= 65535 ? config.port : 8080;
}

function isPidAlive(proc: ProcessAPI, pid: number): boolean {
	try {
		proc.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function splitArgs(s: string): string[] {
	const trimmed = s.trim();
	if (!trimmed) return [];
	return trimmed.split(/\s+/);
}

// Find the values of ALL --host arguments in an already-tokenized arg list.
// Supports both `--host 127.0.0.1` and `--host=127.0.0.1`. Every occurrence
// must be collected, not just the first: whisper-server (like most CLI
// parsers) honors the LAST --host, so checking only the first would let
// `--host 127.0.0.1 --host 0.0.0.0` slip past the loopback guard. Values may
// be empty strings. Exported for tests.
export function getHostArgs(args: string[]): string[] {
	const hosts: string[] = [];
	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		if (a === '--host') {
			hosts.push(args[i + 1] ?? '');
		} else if (a !== undefined && a.startsWith('--host=')) {
			hosts.push(a.slice('--host='.length));
		}
	}
	return hosts;
}

// Whether a host value binds only the loopback interface. Anything else
// (0.0.0.0, a LAN IP, a hostname) would expose the unauthenticated server.
// Exported for tests.
export function isLoopbackHost(host: string): boolean {
	const h = host.trim().toLowerCase();
	return h === '127.0.0.1' || h === 'localhost' || h === '::1' || h === '[::1]';
}

function isPortInUse(net: NetAPI, port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const server = net.createServer();
		let settled = false;
		const done = (inUse: boolean): void => {
			if (settled) return;
			settled = true;
			resolve(inUse);
		};
		server.once('error', () => done(true));
		server.once('listening', () => {
			server.close(() => done(false));
		});
		try {
			server.listen(port, '127.0.0.1');
		} catch {
			done(true);
		}
	});
}

function isPortReachable(net: NetAPI, port: number): Promise<boolean> {
	return new Promise((resolve) => {
		let settled = false;
		const done = (reachable: boolean, socket?: NetSocket): void => {
			if (settled) return;
			settled = true;
			try { socket?.destroy(); } catch { /* best effort */ }
			resolve(reachable);
		};
		try {
			const socket = net.createConnection({ host: '127.0.0.1', port });
			socket.once('connect', () => done(true, socket));
			socket.once('error', () => done(false, socket));
		} catch {
			done(false);
		}
	});
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, ms));
}
