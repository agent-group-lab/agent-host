import { useCallback, useEffect, useRef } from 'react';
import { BPM_START, indexOfBpmEnd, isStrictPrefix } from '../lib/bpm-protocol';

type IUseBpmParserOptions = {
	focus: boolean;
	onPaste: (text: string) => void;
};

type IUseBpmParserResult = {
	// Attempt to handle `input` as part of a BPM paste sequence.
	// Returns true if the input was consumed by the parser (caller should not
	// process it further). Returns false when the input has no BPM markers.
	processBpmInput: (input: string) => boolean;
	// Discard any in-progress paste state without emitting a paste event.
	// Call on Ctrl+C, focus loss, external value reset, and history navigation.
	abortBpmParser: () => void;
};

export const useBpmParser = ({
	focus,
	onPaste,
}: IUseBpmParserOptions): IUseBpmParserResult => {
	const isPastingRef = useRef(false);
	const pasteBufferRef = useRef('');
	const markerPrefixRef = useRef('');

	const abortBpmParser = useCallback(() => {
		isPastingRef.current = false;
		pasteBufferRef.current = '';
		markerPrefixRef.current = '';
	}, []);

	// Enable Bracketed Paste Mode so the terminal wraps paste events with
	// \x1b[200~ ... \x1b[201~ and suppresses the "dangerous paste" warning.
	// Skip in non-TTY environments (CI, pipe redirection).
	useEffect(() => {
		if (!process.stdout.isTTY) {
			return;
		}
		process.stdout.write('\x1b[?2004h');
		return () => {
			process.stdout.write('\x1b[?2004l');
		};
	}, []);

	// Abort in-progress paste when the component loses focus.
	useEffect(() => {
		if (!focus) {
			abortBpmParser();
		}
	}, [focus, abortBpmParser]);

	const processBpmInput = (input: string): boolean => {
		// ── State: awaiting-end ─────────────────────────────────────────────────
		// Already received BPM_START; accumulate until BPM_END arrives.
		if (isPastingRef.current) {
			const combined = pasteBufferRef.current + input;
			const endIdx = indexOfBpmEnd(combined);

			if (endIdx !== -1) {
				const content = combined.slice(0, endIdx);
				isPastingRef.current = false;
				pasteBufferRef.current = '';
				onPaste(content);
			} else {
				pasteBufferRef.current = combined;
			}
			return true;
		}

		// ── State: idle — check for BPM_START (with fragmentation defense) ─────
		// markerPrefixRef accumulates partial escape sequences across events so
		// that a BPM_START split over two input events is still detected.
		const candidate = markerPrefixRef.current + input;

		if (candidate.includes(BPM_START)) {
			markerPrefixRef.current = '';
			const startIdx = candidate.indexOf(BPM_START) + BPM_START.length;
			const afterStart = candidate.slice(startIdx);
			const endIdx = indexOfBpmEnd(afterStart);

			if (endIdx !== -1) {
				// Complete paste arrived in a single event (most common case).
				onPaste(afterStart.slice(0, endIdx));
			} else {
				// Start marker received; content still incoming.
				isPastingRef.current = true;
				pasteBufferRef.current = afterStart;
			}
			return true;
		}

		if (isStrictPrefix(candidate, BPM_START)) {
			// Partial marker fragment — wait for the next event.
			markerPrefixRef.current = candidate;
			return true;
		}

		// No BPM marker; clear prefix buffer and signal that the caller should
		// handle this input through its normal key-processing branches.
		markerPrefixRef.current = '';
		return false;
	};

	return { abortBpmParser, processBpmInput };
};
