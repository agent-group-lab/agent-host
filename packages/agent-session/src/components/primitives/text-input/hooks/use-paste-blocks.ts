import { useCallback, useEffect, useRef, useState } from 'react';
import type { IPasteBlock } from '../lib/text-layout';

type IPasteBlocksUpdater =
	| IPasteBlock[]
	| ((prev: IPasteBlock[]) => IPasteBlock[]);

type IUsePasteBlocksOptions = {
	abortBpmParser: () => void;
	onChange: (value: string) => void;
	originalValue: string;
	valueRef: React.RefObject<string>;
};

type IUsePasteBlocksResult = {
	// Call on every value emission so echo-backs can be distinguished from
	// external resets. All code that calls onChange must use this wrapper.
	emitChange: (newValue: string) => void;
	pasteBlocks: IPasteBlock[];
	pasteBlocksRef: React.RefObject<IPasteBlock[]>;
	setPasteBlocksSafe: (nextOrUpdater: IPasteBlocksUpdater) => void;
};

export const usePasteBlocks = ({
	abortBpmParser,
	onChange,
	originalValue,
	valueRef,
}: IUsePasteBlocksOptions): IUsePasteBlocksResult => {
	const [pasteBlocks, setPasteBlocks] = useState<IPasteBlock[]>([]);
	const pasteBlocksRef = useRef<IPasteBlock[]>([]);
	// Render-body sync keeps the ref consistent with React state after each
	// render. The ref may already be ahead of state (set synchronously by
	// setPasteBlocksSafe) — that is intentional and correct.
	pasteBlocksRef.current = pasteBlocks;

	// Track recent locally-emitted values so delayed controlled echo-backs do
	// not get mistaken for external resets that should clear paste blocks.
	const pendingLocalValuesRef = useRef<string[]>([]);

	// All value emissions must go through emitChange so they are registered in
	// pendingLocalValuesRef. This includes history navigation (useTextHistory
	// receives emitChange as its onChange option).
	const emitChange = useCallback(
		(newValue: string) => {
			valueRef.current = newValue;
			pendingLocalValuesRef.current.push(newValue);
			if (pendingLocalValuesRef.current.length > 20) {
				pendingLocalValuesRef.current.shift();
			}
			onChange(newValue);
		},
		[onChange, valueRef],
	);

	const setPasteBlocksSafe = useCallback(
		(nextOrUpdater: IPasteBlocksUpdater) => {
			// Compute next from the ref (which is always the latest intended value),
			// write it synchronously so subsequent event-handler reads in the same
			// batch see the updated blocks, then queue the React state update.
			// This mirrors the setCursorOffsetSafe pattern.
			const next =
				typeof nextOrUpdater === 'function'
					? nextOrUpdater(pasteBlocksRef.current)
					: nextOrUpdater;
			pasteBlocksRef.current = next;
			setPasteBlocks(next);
		},
		[],
	);

	// Clear paste blocks only when the controlled value diverges from all recent
	// local emissions. A matching value means the parent is echoing back one of
	// our own emissions — blocks should be preserved in that case.
	useEffect(() => {
		const echoIndex = pendingLocalValuesRef.current.indexOf(originalValue);

		if (echoIndex !== -1) {
			pendingLocalValuesRef.current = pendingLocalValuesRef.current.slice(
				echoIndex + 1,
			);
			return;
		}

		abortBpmParser();
		pendingLocalValuesRef.current = [];
		pasteBlocksRef.current = [];
		setPasteBlocks([]);
	}, [originalValue, abortBpmParser]);

	return { emitChange, pasteBlocks, pasteBlocksRef, setPasteBlocksSafe };
};
