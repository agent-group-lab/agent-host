import type { Key } from 'ink';

// ─── BPM Marker Constants ─────────────────────────────────────────────────────
//
// Ink strips the leading \x1b from any input that starts with ESC, so the
// start marker we receive is '[200~' (without \x1b prefix).
//
// The end marker may arrive in two forms depending on how the terminal chunks
// its output:
//   - '[201~'      when it arrives as a standalone event (ESC stripped by Ink)
//   - '\x1b[201~'  when it is embedded after content in the same chunk (ESC is
//                  not at the very start so Ink does not strip it)
// indexOfBpmEnd handles both forms transparently.

export const BPM_START = '[200~';

export const indexOfBpmEnd = (str: string): number => {
	// Searching '\x1b[201~' yields the index of the ESC character, which is one
	// position before '[201~'. Math.min picks the lower (earlier) index, so the
	// cut point is always before any ESC prefix that may precede the marker.
	const withEsc = str.indexOf('\x1b[201~');
	const withoutEsc = str.indexOf('[201~');
	if (withEsc === -1) {
		return withoutEsc;
	}
	if (withoutEsc === -1) {
		return withEsc;
	}
	return Math.min(withEsc, withoutEsc);
};

// Returns true when str is a non-empty strict prefix of target (not the full
// match). Used to detect a partially-arrived BPM_START across two input events.
export const isStrictPrefix = (str: string, target: string): boolean =>
	str.length > 0 && str.length < target.length && target.startsWith(str);

// ─── Paste Classification ─────────────────────────────────────────────────────

type IInputEventKind = 'key' | 'paste';

// Heuristic fallback for terminals that do not support Bracketed Paste Mode.
// A single useInput event delivering more than 1 character is almost certainly
// a paste in those environments.
export const classifyInputEvent = (
	input: string,
	key: Key,
): IInputEventKind => {
	if (input.length > 1 && !key.ctrl && !key.meta) {
		return 'paste';
	}
	return 'key';
};

// ─── Collapse Policy ──────────────────────────────────────────────────────────

export const shouldCollapseToBlock = (text: string): boolean =>
	text.length > 200 || text.split('\n').length > 5;
