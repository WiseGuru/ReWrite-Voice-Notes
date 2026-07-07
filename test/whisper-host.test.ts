import { describe, expect, it } from 'vitest';
import { getHostArgs, isLoopbackHost } from '../src/whisper-host';

describe('getHostArgs', () => {
	it('returns an empty array when no --host is present', () => {
		expect(getHostArgs(['-m', 'model.bin', '--port', '8080'])).toEqual([]);
	});

	it('collects a single --host value (space form)', () => {
		expect(getHostArgs(['--host', '127.0.0.1'])).toEqual(['127.0.0.1']);
	});

	it('collects a single --host value (= form)', () => {
		expect(getHostArgs(['--host=127.0.0.1'])).toEqual(['127.0.0.1']);
	});

	// Regression test for the bypass: whisper-server honors the LAST --host, so every
	// occurrence must be collected, not just the first.
	it('collects every --host occurrence, not just the first', () => {
		expect(getHostArgs(['--host', '127.0.0.1', '--host', '0.0.0.0'])).toEqual(['127.0.0.1', '0.0.0.0']);
	});

	it('collects a mix of space and = forms', () => {
		expect(getHostArgs(['--host=127.0.0.1', '--host', '0.0.0.0'])).toEqual(['127.0.0.1', '0.0.0.0']);
	});

	it('treats a --host with no following value as empty string, not missing', () => {
		expect(getHostArgs(['--host'])).toEqual(['']);
	});
});

describe('isLoopbackHost', () => {
	it.each([
		['127.0.0.1', true],
		['localhost', true],
		['LOCALHOST', true],
		['::1', true],
		['[::1]', true],
		['  127.0.0.1  ', true],
		['0.0.0.0', false],
		['192.168.1.5', false],
		['example.com', false],
		['', false],
	])('isLoopbackHost(%s) === %s', (host, expected) => {
		expect(isLoopbackHost(host)).toBe(expected);
	});
});
