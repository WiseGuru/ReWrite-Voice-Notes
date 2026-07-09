import { describe, expect, it } from 'vitest';
import { getHostArgs, isLoopbackHost, shouldStopWhenIdle } from '../src/whisper-host';

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

describe('shouldStopWhenIdle', () => {
	const MIN = 60_000;

	it('never stops when idle stop is disabled (0 minutes)', () => {
		expect(shouldStopWhenIdle('running', 'spawned', 0, 0, 0, 10 * MIN)).toBe(false);
	});

	it('stops a spawned server idle past the threshold', () => {
		expect(shouldStopWhenIdle('running', 'spawned', 0, 0, 5, 5 * MIN)).toBe(true);
	});

	it('stops an adopted server idle past the threshold', () => {
		expect(shouldStopWhenIdle('running', 'adopted', 0, 0, 5, 6 * MIN)).toBe(true);
	});

	it('does not stop before the threshold elapses', () => {
		expect(shouldStopWhenIdle('running', 'spawned', 0, 0, 5, 4 * MIN)).toBe(false);
	});

	// External servers were started by someone else; ReWrite never stops them.
	it('never stops an external server', () => {
		expect(shouldStopWhenIdle('external', 'external', 0, 0, 5, 60 * MIN)).toBe(false);
	});

	// A long transcription on a big model must not be killed under the user even
	// when the last-activity timestamp is far in the past.
	it('never stops while a transcription is in flight', () => {
		expect(shouldStopWhenIdle('running', 'spawned', 1, 0, 5, 60 * MIN)).toBe(false);
	});

	it('does nothing when the server is not running', () => {
		expect(shouldStopWhenIdle('stopped', null, 0, 0, 5, 60 * MIN)).toBe(false);
		expect(shouldStopWhenIdle('starting', 'spawned', 0, 0, 5, 60 * MIN)).toBe(false);
	});

	it('does nothing without an activity timestamp', () => {
		expect(shouldStopWhenIdle('running', 'spawned', 0, null, 5, 60 * MIN)).toBe(false);
	});
});
