import { Newline, Text } from 'ink';
import { Fragment } from 'react';
import type {
	IDisplayUnit,
	IVisualLine,
	IVisualPosition,
} from '../lib/text-layout';
import { PasteBlock } from './paste-block';

type IVisualContentProps = {
	cursorOffset: number;
	cursorPosition: IVisualPosition | null;
	displayUnits: IDisplayUnit[];
	focus: boolean;
	originalValue: string;
	placeholder: string;
	visualLines: IVisualLine[];
};

const renderUnit = (
	unit: IDisplayUnit,
	line: IVisualLine,
	originalValue: string,
	cursorOffset: number,
	isCursorRow: boolean,
	unitKey: string,
): React.ReactNode => {
	if (unit.kind === 'block') {
		const cursorBeforeBlock = isCursorRow && cursorOffset === unit.rawStart;
		return (
			<Fragment key={unitKey}>
				{cursorBeforeBlock ? <Text inverse> </Text> : null}
				<PasteBlock charCount={unit.rawEnd - unit.rawStart} />
			</Fragment>
		);
	}

	// Text unit: clamp to visual line bounds
	const segStart = Math.max(unit.rawStart, line.startOffset);
	const segEnd = Math.min(unit.rawEnd, line.endOffset);

	if (segStart >= segEnd) {
		// Allow cursor rendering at zero-width positions (empty line, after block at line end)
		if (!isCursorRow || cursorOffset !== segStart) {
			return null;
		}
	}

	// A text unit owns the cursor only if cursorOffset is strictly inside
	// [segStart, segEnd), or at segEnd when that is the very end of the string.
	// When cursorOffset === segEnd < originalValue.length the next (block) unit
	// owns the cursor instead.
	const cursorOwned =
		isCursorRow &&
		cursorOffset >= segStart &&
		(cursorOffset < segEnd ||
			(cursorOffset === segEnd && unit.rawEnd === originalValue.length));

	if (!cursorOwned) {
		return (
			<Fragment key={unitKey}>{originalValue.slice(segStart, segEnd)}</Fragment>
		);
	}

	// Cursor is within this text segment
	const cursorAtSegEnd = cursorOffset === segEnd;
	const cursorSegStart = cursorAtSegEnd ? segEnd : cursorOffset;
	// Use the grapheme segment to find the correct end boundary so that
	// multi-code-unit graphemes (surrogate pairs, ZWJ emoji) are not split.
	const cursorGrapheme = unit.graphemes.find((g) => g.index === cursorOffset);
	const cursorSegEnd = cursorAtSegEnd
		? segEnd
		: (cursorGrapheme?.endOffset ?? segEnd);

	const beforeCursor = originalValue.slice(segStart, cursorSegStart);
	const cursorText = cursorAtSegEnd
		? ' '
		: originalValue.slice(cursorSegStart, cursorSegEnd);
	const afterCursor = cursorAtSegEnd
		? null
		: originalValue.slice(cursorSegEnd, segEnd);

	return (
		<Fragment key={unitKey}>
			{beforeCursor}
			<Text inverse>{cursorText}</Text>
			{afterCursor}
		</Fragment>
	);
};

export const VisualContent = ({
	cursorOffset,
	cursorPosition,
	displayUnits,
	focus,
	originalValue,
	placeholder,
	visualLines,
}: IVisualContentProps) => {
	if (!originalValue) {
		return (
			<Text>
				{focus ? <Text inverse> </Text> : null}
				{placeholder ? <Text dimColor>{placeholder}</Text> : null}
			</Text>
		);
	}

	return (
		<Text>
			{visualLines.map((line, rowIndex) => {
				const isCursorRow = focus && cursorPosition?.row === rowIndex;

				// Display units that overlap with this visual line, or that contain
				// the cursor offset on the cursor row (handles empty-line cursor and
				// cursor at block.end at line end where overlap would be zero-width).
				const lineUnits = displayUnits.filter(
					(u) =>
						(u.rawStart < line.endOffset && u.rawEnd > line.startOffset) ||
						(isCursorRow &&
							cursorOffset >= u.rawStart &&
							cursorOffset <= u.rawEnd),
				);

				return (
					<Fragment key={String(rowIndex)}>
						{lineUnits.map((unit, unitIndex) =>
							renderUnit(
								unit,
								line,
								originalValue,
								cursorOffset,
								isCursorRow,
								`${rowIndex}-${unitIndex}`,
							),
						)}
						{rowIndex < visualLines.length - 1 ? <Newline /> : null}
					</Fragment>
				);
			})}
		</Text>
	);
};
