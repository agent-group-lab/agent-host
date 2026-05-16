import { Box, useInput } from 'ink';
import { useMemo, useRef } from 'react';
import { DefaultContent } from './components/default-content';
import { VisualContent } from './components/visual-content';
import { useBpmParser } from './hooks/use-bpm-parser';
import { useCursorNavigation } from './hooks/use-cursor-navigation';
import { usePasteBlocks } from './hooks/use-paste-blocks';
import { useResolvedColumns } from './hooks/use-resolved-columns';
import { useTextHistory } from './hooks/use-text-history';
import { useTextMutation } from './hooks/use-text-mutation';
import { classifyInputEvent } from './lib/bpm-protocol';
import {
	buildDisplayUnits,
	buildVisualLines,
	getBlockAtLeftEdge,
	getBlockAtRightEdge,
	getGraphemeSegments,
	getNextGrapheme,
	getPreviousGrapheme,
	getVisualPosition,
} from './lib/text-layout';

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_MULTILINE_NEWLINE_INPUT_SEQUENCES = [
	'\n',
	'\x1b\r',
	'\x1b[27;2;13~',
	'\x1b[13;2u',
	'[27;2;13~',
] as const;

// ─── Props ────────────────────────────────────────────────────────────────────

export type ITextInputProps = {
	columns?: number;
	focus?: boolean;
	history?: boolean;
	multiline?: boolean;
	newlineInputSequences?: readonly string[];
	onChange: (value: string) => void;
	onSubmit?: (value: string) => void;
	placeholder?: string;
	value: string;
};

// ─── Component ────────────────────────────────────────────────────────────────

export const TextInput = ({
	columns,
	focus = true,
	history = false,
	multiline = false,
	newlineInputSequences = DEFAULT_MULTILINE_NEWLINE_INPUT_SEQUENCES,
	onChange,
	onSubmit,
	placeholder = '',
	value: originalValue,
}: ITextInputProps) => {
	// Refs that allow key handler to read latest values without stale closures.
	const valueRef = useRef(originalValue);
	valueRef.current = originalValue;

	const { containerRef, resolvedColumns } = useResolvedColumns(columns);

	// ─── BPM parser (forward-declared so abort is available to usePasteBlocks) ──

	// paste() from useTextMutation is defined after this hook; the BPM hook
	// receives a stable ref wrapper so it always calls the current definition.
	const handlePasteRef = useRef<(text: string) => void>(() => {});
	const { abortBpmParser, processBpmInput } = useBpmParser({
		focus,
		onPaste: (text) => handlePasteRef.current(text),
	});

	// ─── Paste blocks ────────────────────────────────────────────────────────────

	const { emitChange, pasteBlocks, pasteBlocksRef, setPasteBlocksSafe } =
		usePasteBlocks({
			abortBpmParser,
			onChange,
			originalValue,
			valueRef,
		});

	const newlineInputs = useMemo(
		() => new Set(newlineInputSequences),
		[newlineInputSequences],
	);

	// ─── Render-time layout (display only) ───────────────────────────────────────
	// These memos feed the renderer. Event handlers must NOT rely on them for
	// correctness — use buildTextLayoutSnapshot / getGraphemeSegments on-demand
	// from refs instead (see useCursorNavigation and useTextMutation).
	const graphemes = useMemo(
		() => getGraphemeSegments(originalValue),
		[originalValue],
	);
	const displayUnits = useMemo(
		() => buildDisplayUnits(originalValue, graphemes, pasteBlocks),
		[originalValue, graphemes, pasteBlocks],
	);
	const visualLines = useMemo(() => {
		if (!multiline || resolvedColumns === undefined) {
			return [];
		}
		return buildVisualLines({ columns: resolvedColumns, displayUnits });
	}, [displayUnits, multiline, resolvedColumns]);

	const isVisualMultiline = multiline && resolvedColumns !== undefined;

	// ─────────────────────────────────────────────────────────────────────────────

	const {
		cursorOffset,
		cursorOffsetRef,
		moveCursorToBoundary,
		setCursorOffsetSafe,
		setPreferredColumn,
		tryMoveDownWithinCurrentValue,
		tryMoveUpWithinCurrentValue,
	} = useCursorNavigation({
		multiline,
		originalValue,
		pasteBlocksRef,
		resolvedColumns,
		valueRef,
	});

	// cursorPosition is render-time only; useCursorNavigation computes fresh
	// positions internally when navigating.
	const cursorPosition = useMemo(
		() =>
			isVisualMultiline && visualLines.length > 0
				? getVisualPosition({ displayUnits, offset: cursorOffset, visualLines })
				: null,
		[displayUnits, cursorOffset, isVisualMultiline, visualLines],
	);

	const { clearAll, deleteBackward, insertText, paste } = useTextMutation({
		abortBpmParser,
		cursorOffsetRef,
		emitChange,
		pasteBlocksRef,
		setCursorOffsetSafe,
		setPreferredColumn,
		setPasteBlocksSafe,
		valueRef,
	});
	handlePasteRef.current = paste;

	const { commitHistory, enterHistoryFromTop, moveHistoryDownOrRestoreDraft } =
		useTextHistory({
			currentBlocks: pasteBlocks,
			enabled: history,
			onChange: emitChange,
			onNavigate: ({ blocks, value }) => {
				abortBpmParser();
				valueRef.current = value;
				setCursorOffsetSafe(value.length);
				setPreferredColumn(null);
				setPasteBlocksSafe(blocks);
			},
			originalValue,
		});

	// ─── Key Handler (branch order per design doc) ───────────────────────────────

	useInput(
		(input, key) => {
			// 1. Tab → bubble to parent container
			if (key.tab) {
				return false;
			}

			// 2. BPM parser — must run before key.return so pastes containing \n
			//    are captured whole instead of triggering submit.
			if (processBpmInput(input)) {
				return true;
			}

			// 3. Ctrl+C — abort BPM parser; clear value and blocks
			if (key.ctrl && input === 'c' && valueRef.current) {
				clearAll();
				return true;
			}

			// 4. Multiline newline sequences
			if (
				multiline &&
				((key.ctrl && input === 'j') ||
					(key.return && key.meta) ||
					newlineInputs.has(input))
			) {
				insertText('\n');
				return true;
			}

			// 5. Return — submit
			if (key.return) {
				const currentValue = valueRef.current;
				commitHistory(currentValue, pasteBlocksRef.current);
				onSubmit?.(currentValue);
				return true;
			}

			// 5. Arrow left/right (with block-jump)
			if (key.leftArrow) {
				const currentCursorOffset = cursorOffsetRef.current;
				const currentPasteBlocks = pasteBlocksRef.current;
				// If cursor is at the right edge of a block, jump to its left edge
				const block = getBlockAtRightEdge(
					currentCursorOffset,
					currentPasteBlocks,
				);
				if (block) {
					setCursorOffsetSafe(block.start);
					setPreferredColumn(null);
					return true;
				}

				const previousGrapheme = getPreviousGrapheme({
					graphemes: getGraphemeSegments(valueRef.current),
					offset: currentCursorOffset,
				});
				setCursorOffsetSafe(previousGrapheme?.index ?? 0);
				setPreferredColumn(null);
				return true;
			}

			if (key.rightArrow) {
				const currentCursorOffset = cursorOffsetRef.current;
				const currentPasteBlocks = pasteBlocksRef.current;
				// If cursor is at the left edge of a block, jump to its right edge
				const block = getBlockAtLeftEdge(
					currentCursorOffset,
					currentPasteBlocks,
				);
				if (block) {
					setCursorOffsetSafe(block.end);
					setPreferredColumn(null);
					return true;
				}

				const nextGrapheme = getNextGrapheme({
					graphemes: getGraphemeSegments(valueRef.current),
					offset: currentCursorOffset,
				});
				setCursorOffsetSafe(nextGrapheme?.endOffset ?? valueRef.current.length);
				setPreferredColumn(null);
				return true;
			}

			// 6. Arrow up/down (line navigation + history)
			if (key.upArrow) {
				if (tryMoveUpWithinCurrentValue()) {
					return true;
				}

				if (cursorOffsetRef.current > 0) {
					moveCursorToBoundary('up');
					return true;
				}

				return enterHistoryFromTop();
			}

			if (key.downArrow) {
				if (tryMoveDownWithinCurrentValue()) {
					return true;
				}

				if (cursorOffsetRef.current < valueRef.current.length) {
					moveCursorToBoundary('down');
					return true;
				}

				return moveHistoryDownOrRestoreDraft();
			}

			// 7. Backspace / Delete → backward delete (block-aware)
			if (key.backspace || key.delete) {
				deleteBackward();
				return true;
			}

			// 8. No printable input (function keys etc.)
			if (!input) {
				return false;
			}

			// 10. Fallback: heuristic paste detection for non-BPM terminals (MUST be last)
			if (classifyInputEvent(input, key) === 'paste') {
				paste(input);
				return true;
			}

			if (!key.ctrl) {
				insertText(input);
				return true;
			}

			return false;
		},
		{ isActive: focus },
	);

	// ─── Render ──────────────────────────────────────────────────────────────────

	return (
		<Box flexGrow={1} ref={containerRef}>
			{isVisualMultiline ? (
				<VisualContent
					cursorOffset={cursorOffset}
					cursorPosition={cursorPosition}
					displayUnits={displayUnits}
					focus={focus}
					originalValue={originalValue}
					placeholder={placeholder}
					visualLines={visualLines}
				/>
			) : (
				<DefaultContent
					cursorOffset={cursorOffset}
					displayUnits={displayUnits}
					focus={focus}
					placeholder={placeholder}
					value={originalValue}
				/>
			)}
		</Box>
	);
};
