import { useEffect, useRef, useState } from 'react';
import type { IPasteBlock } from '../lib/text-layout';
import {
	buildTextLayoutSnapshot,
	getAdjacentLineOffset,
	getLineInfo,
	getOffsetFromVisualPosition,
	getVisualPosition,
} from '../lib/text-layout';

type IUseCursorNavigationOptions = {
	multiline: boolean;
	originalValue: string;
	pasteBlocksRef: React.RefObject<IPasteBlock[]>;
	resolvedColumns: number | undefined;
	valueRef: React.MutableRefObject<string>;
};

type IUseCursorNavigationResult = {
	cursorOffset: number;
	cursorOffsetRef: React.RefObject<number>;
	moveCursorToBoundary: (direction: 'down' | 'up') => void;
	preferredColumn: number | null;
	setCursorOffsetSafe: (offset: number) => void;
	setPreferredColumn: (col: number | null) => void;
	tryMoveDownWithinCurrentValue: () => boolean;
	tryMoveUpWithinCurrentValue: () => boolean;
};

export const useCursorNavigation = ({
	multiline,
	originalValue,
	pasteBlocksRef,
	resolvedColumns,
	valueRef,
}: IUseCursorNavigationOptions): IUseCursorNavigationResult => {
	const [cursorOffset, setCursorOffset] = useState(originalValue.length);
	const [preferredColumn, setPreferredColumnState] = useState<number | null>(
		null,
	);

	// Ref mirrors allow event handlers to read the latest values without
	// waiting for the next render cycle.
	const cursorOffsetRef = useRef(originalValue.length);
	const preferredColumnRef = useRef<number | null>(null);
	cursorOffsetRef.current = cursorOffset;

	const setCursorOffsetSafe = (nextOffset: number) => {
		cursorOffsetRef.current = nextOffset;
		setCursorOffset(nextOffset);
	};

	const setPreferredColumn = (col: number | null) => {
		preferredColumnRef.current = col;
		setPreferredColumnState(col);
	};

	// Sync cursor down when the value is externally shortened.
	// originalValue (not valueRef) must be in deps so the effect fires on
	// controlled prop changes.
	useEffect(() => {
		if (cursorOffset > originalValue.length) {
			cursorOffsetRef.current = originalValue.length;
			setCursorOffset(originalValue.length);
		}
	}, [cursorOffset, originalValue]);

	const moveCursorToBoundary = (direction: 'down' | 'up') => {
		if (direction === 'up') {
			if (cursorOffsetRef.current > 0) {
				setCursorOffsetSafe(0);
				setPreferredColumn(null);
			}
			return;
		}

		if (cursorOffsetRef.current < valueRef.current.length) {
			setCursorOffsetSafe(valueRef.current.length);
			setPreferredColumn(null);
		}
	};

	const tryMoveUpWithinCurrentValue = (): boolean => {
		if (!multiline) {
			return false;
		}

		const currentOffset = cursorOffsetRef.current;
		const currentPreferredColumn = preferredColumnRef.current;
		const isVisualMultiline = resolvedColumns !== undefined;

		if (isVisualMultiline) {
			// Compute a fresh snapshot so navigation is based on the current
			// value + blocks + columns, not the render-time layout snapshot.
			const { displayUnits, visualLines } = buildTextLayoutSnapshot({
				columns: resolvedColumns,
				pasteBlocks: pasteBlocksRef.current,
				value: valueRef.current,
			});

			if (visualLines.length > 0) {
				const currentCursorPosition = getVisualPosition({
					displayUnits,
					offset: currentOffset,
					visualLines,
				});
				const targetColumn =
					currentPreferredColumn ?? currentCursorPosition.column;
				const nextRow = currentCursorPosition.row - 1;

				if (nextRow < 0) {
					return false;
				}

				setCursorOffsetSafe(
					getOffsetFromVisualPosition({
						column: targetColumn,
						displayUnits,
						row: nextRow,
						visualLines,
					}),
				);
				setPreferredColumn(targetColumn);
				return true;
			}
		}

		const currentValue = valueRef.current;
		const targetColumn =
			currentPreferredColumn ?? getLineInfo(currentValue, currentOffset).column;
		const nextOffset = getAdjacentLineOffset({
			direction: 'up',
			offset: currentOffset,
			preferredColumn: targetColumn,
			value: currentValue,
		});

		if (nextOffset === null) {
			return false;
		}

		setCursorOffsetSafe(nextOffset);
		setPreferredColumn(targetColumn);
		return true;
	};

	const tryMoveDownWithinCurrentValue = (): boolean => {
		if (!multiline) {
			return false;
		}

		const currentOffset = cursorOffsetRef.current;
		const currentPreferredColumn = preferredColumnRef.current;
		const isVisualMultiline = resolvedColumns !== undefined;

		if (isVisualMultiline) {
			const { displayUnits, visualLines } = buildTextLayoutSnapshot({
				columns: resolvedColumns,
				pasteBlocks: pasteBlocksRef.current,
				value: valueRef.current,
			});

			if (visualLines.length > 0) {
				const currentCursorPosition = getVisualPosition({
					displayUnits,
					offset: currentOffset,
					visualLines,
				});
				const targetColumn =
					currentPreferredColumn ?? currentCursorPosition.column;
				const nextRow = currentCursorPosition.row + 1;

				if (nextRow >= visualLines.length) {
					return false;
				}

				setCursorOffsetSafe(
					getOffsetFromVisualPosition({
						column: targetColumn,
						displayUnits,
						row: nextRow,
						visualLines,
					}),
				);
				setPreferredColumn(targetColumn);
				return true;
			}
		}

		const currentValue = valueRef.current;
		const targetColumn =
			currentPreferredColumn ?? getLineInfo(currentValue, currentOffset).column;
		const nextOffset = getAdjacentLineOffset({
			direction: 'down',
			offset: currentOffset,
			preferredColumn: targetColumn,
			value: currentValue,
		});

		if (nextOffset === null) {
			return false;
		}

		setCursorOffsetSafe(nextOffset);
		setPreferredColumn(targetColumn);
		return true;
	};

	return {
		cursorOffset,
		cursorOffsetRef,
		moveCursorToBoundary,
		preferredColumn,
		setCursorOffsetSafe,
		setPreferredColumn,
		tryMoveDownWithinCurrentValue,
		tryMoveUpWithinCurrentValue,
	};
};
