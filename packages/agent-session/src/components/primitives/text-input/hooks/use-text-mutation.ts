import { shouldCollapseToBlock } from '../lib/bpm-protocol';
import type { IPasteBlock } from '../lib/text-layout';
import {
	getBlockAtRightEdge,
	getGraphemeSegments,
	getPreviousGrapheme,
	removeRangeFromBlocks,
	shiftBlocksAfter,
} from '../lib/text-layout';

type IPasteBlocksUpdater =
	| IPasteBlock[]
	| ((prev: IPasteBlock[]) => IPasteBlock[]);

type IUseTextMutationOptions = {
	abortBpmParser: () => void;
	cursorOffsetRef: React.RefObject<number>;
	emitChange: (value: string) => void;
	pasteBlocksRef: React.RefObject<IPasteBlock[]>;
	setCursorOffsetSafe: (offset: number) => void;
	setPreferredColumn: (col: number | null) => void;
	setPasteBlocksSafe: (updater: IPasteBlocksUpdater) => void;
	valueRef: React.MutableRefObject<string>;
};

type IUseTextMutationResult = {
	clearAll: () => void;
	deleteBackward: () => void;
	insertText: (text: string) => void;
	paste: (text: string) => void;
};

export const useTextMutation = ({
	abortBpmParser,
	cursorOffsetRef,
	emitChange,
	pasteBlocksRef,
	setCursorOffsetSafe,
	setPreferredColumn,
	setPasteBlocksSafe,
	valueRef,
}: IUseTextMutationOptions): IUseTextMutationResult => {
	const insertText = (text: string) => {
		const currentValue = valueRef.current;
		const currentCursorOffset = cursorOffsetRef.current;
		const nextValue =
			currentValue.slice(0, currentCursorOffset) +
			text +
			currentValue.slice(currentCursorOffset);
		emitChange(nextValue);
		setCursorOffsetSafe(currentCursorOffset + text.length);
		setPreferredColumn(null);
		setPasteBlocksSafe((prev) =>
			shiftBlocksAfter(prev, currentCursorOffset, text.length),
		);
	};

	const paste = (text: string) => {
		const currentValue = valueRef.current;
		const currentCursorOffset = cursorOffsetRef.current;
		const nextValue =
			currentValue.slice(0, currentCursorOffset) +
			text +
			currentValue.slice(currentCursorOffset);
		const newEnd = currentCursorOffset + text.length;

		setPasteBlocksSafe((prev) => {
			const updatedBlocks = shiftBlocksAfter(
				prev,
				currentCursorOffset,
				text.length,
			);
			if (!shouldCollapseToBlock(text)) {
				return updatedBlocks;
			}
			return [
				...updatedBlocks,
				{ end: newEnd, start: currentCursorOffset },
			].sort((a, b) => a.start - b.start);
		});

		emitChange(nextValue);
		setCursorOffsetSafe(newEnd);
		setPreferredColumn(null);
	};

	const deleteBackward = () => {
		const currentCursorOffset = cursorOffsetRef.current;
		const currentPasteBlocks = pasteBlocksRef.current;

		if (currentCursorOffset === 0) {
			return;
		}

		// If cursor is at the right edge of a paste block, delete the whole block.
		const block = getBlockAtRightEdge(currentCursorOffset, currentPasteBlocks);
		if (block) {
			const len = block.end - block.start;
			const currentValue = valueRef.current;
			const nextValue =
				currentValue.slice(0, block.start) + currentValue.slice(block.end);
			emitChange(nextValue);
			setPasteBlocksSafe((prev) =>
				removeRangeFromBlocks(prev, block.start, len),
			);
			setCursorOffsetSafe(block.start);
			setPreferredColumn(null);
			return;
		}

		// Compute graphemes on-demand so deletion always uses the latest text,
		// not the render-time snapshot.
		const previousGrapheme = getPreviousGrapheme({
			graphemes: getGraphemeSegments(valueRef.current),
			offset: currentCursorOffset,
		});

		if (!previousGrapheme) {
			return;
		}

		const currentValue = valueRef.current;
		const nextValue =
			currentValue.slice(0, previousGrapheme.index) +
			currentValue.slice(currentCursorOffset);
		emitChange(nextValue);
		setPasteBlocksSafe((prev) =>
			removeRangeFromBlocks(
				prev,
				previousGrapheme.index,
				currentCursorOffset - previousGrapheme.index,
			),
		);
		setCursorOffsetSafe(previousGrapheme.index);
		setPreferredColumn(null);
	};

	const clearAll = () => {
		abortBpmParser();
		emitChange('');
		setCursorOffsetSafe(0);
		setPreferredColumn(null);
		setPasteBlocksSafe([]);
	};

	return { clearAll, deleteBackward, insertText, paste };
};
