import stringWidth from 'string-width';

// ─── Primitive Types ──────────────────────────────────────────────────────────

export type IVisualLine = {
	endOffset: number;
	hardBreak: boolean;
	startOffset: number;
};

export type IVisualPosition = {
	column: number;
	row: number;
};

export type IGraphemeSegment = {
	endOffset: number;
	index: number;
	segment: string;
	width: number;
};

export type IPasteBlock = {
	end: number; // UTF-16 code unit offset, exclusive
	start: number; // UTF-16 code unit offset, inclusive
};

// ─── Display Unit ─────────────────────────────────────────────────────────────

export type IDisplayUnit =
	| {
			displayWidth: number;
			graphemes: IGraphemeSegment[];
			kind: 'text';
			rawEnd: number;
			rawStart: number;
	  }
	| {
			displayWidth: number;
			kind: 'block';
			label: string;
			rawEnd: number;
			rawStart: number;
	  };

// ─── Segmenter ────────────────────────────────────────────────────────────────

const segmenter = new Intl.Segmenter(undefined, {
	granularity: 'grapheme',
});

export const getGraphemeSegments = (text: string): IGraphemeSegment[] =>
	Array.from(segmenter.segment(text), ({ segment, index }) => ({
		endOffset: index + segment.length,
		index,
		segment,
		width: stringWidth(segment),
	}));

// ─── Display Units ────────────────────────────────────────────────────────────

export const buildDisplayUnits = (
	value: string,
	graphemes: IGraphemeSegment[],
	pasteBlocks: IPasteBlock[],
): IDisplayUnit[] => {
	const units: IDisplayUnit[] = [];
	let pos = 0;

	for (const block of pasteBlocks) {
		if (pos < block.start) {
			const seg = graphemes.filter(
				(g) => g.index >= pos && g.index < block.start,
			);
			units.push({
				displayWidth: seg.reduce(
					(sum, g) => sum + (g.segment === '\n' ? 0 : g.width),
					0,
				),
				graphemes: seg,
				kind: 'text',
				rawEnd: block.start,
				rawStart: pos,
			});
		}

		const label = `[Pasted ${block.end - block.start} chars]`;
		units.push({
			displayWidth: stringWidth(label),
			kind: 'block',
			label,
			rawEnd: block.end,
			rawStart: block.start,
		});

		pos = block.end;
	}

	if (pos <= value.length) {
		const seg = graphemes.filter((g) => g.index >= pos);
		units.push({
			displayWidth: seg.reduce(
				(sum, g) => sum + (g.segment === '\n' ? 0 : g.width),
				0,
			),
			graphemes: seg,
			kind: 'text',
			rawEnd: value.length,
			rawStart: pos,
		});
	}

	return units;
};

// ─── Hard-newline helpers (unchanged) ─────────────────────────────────────────

export const getLineInfo = (value: string, offset: number) => {
	const lineStart = value.lastIndexOf('\n', Math.max(0, offset - 1)) + 1;
	const lineEndIndex = value.indexOf('\n', offset);
	const lineEnd = lineEndIndex === -1 ? value.length : lineEndIndex;

	return {
		column: offset - lineStart,
		lineEnd,
		lineStart,
	};
};

export const getAdjacentLineOffset = ({
	direction,
	offset,
	preferredColumn,
	value,
}: {
	direction: 'down' | 'up';
	offset: number;
	preferredColumn: number;
	value: string;
}) => {
	const current = getLineInfo(value, offset);

	if (direction === 'up') {
		if (current.lineStart === 0) {
			return null;
		}

		const previousLineEnd = current.lineStart - 1;
		const previousLineStart =
			value.lastIndexOf('\n', Math.max(0, previousLineEnd - 1)) + 1;
		return Math.min(previousLineStart + preferredColumn, previousLineEnd);
	}

	if (current.lineEnd === value.length) {
		return null;
	}

	const nextLineStart = current.lineEnd + 1;
	const nextLineEndIndex = value.indexOf('\n', nextLineStart);
	const nextLineEnd = nextLineEndIndex === -1 ? value.length : nextLineEndIndex;

	return Math.min(nextLineStart + preferredColumn, nextLineEnd);
};

// ─── Visual Layout ────────────────────────────────────────────────────────────

export const buildVisualLines = ({
	columns,
	displayUnits,
}: {
	columns: number;
	displayUnits: IDisplayUnit[];
}): IVisualLine[] => {
	const visualLines: IVisualLine[] = [];
	let colUsed = 0;
	let lineStart = 0;

	for (const unit of displayUnits) {
		if (unit.kind === 'text') {
			for (const grapheme of unit.graphemes) {
				if (grapheme.segment === '\n') {
					visualLines.push({
						endOffset: grapheme.index,
						hardBreak: true,
						startOffset: lineStart,
					});
					lineStart = grapheme.endOffset;
					colUsed = 0;
					continue;
				}

				if (colUsed > 0 && colUsed + grapheme.width > columns) {
					visualLines.push({
						endOffset: grapheme.index,
						hardBreak: false,
						startOffset: lineStart,
					});
					lineStart = grapheme.index;
					colUsed = grapheme.width;
					continue;
				}

				colUsed += grapheme.width;
			}
		} else {
			// Block unit: treat as single non-breakable inline token.
			// Wrap to new line if it doesn't fit (and we're not already at line start).
			if (colUsed > 0 && colUsed + unit.displayWidth > columns) {
				visualLines.push({
					endOffset: unit.rawStart,
					hardBreak: false,
					startOffset: lineStart,
				});
				lineStart = unit.rawStart;
				colUsed = 0;
			}

			colUsed += unit.displayWidth;
		}
	}

	const totalRawEnd =
		displayUnits.length > 0
			? (displayUnits[displayUnits.length - 1]?.rawEnd ?? 0)
			: 0;

	if (lineStart <= totalRawEnd) {
		visualLines.push({
			endOffset: totalRawEnd,
			hardBreak: false,
			startOffset: lineStart,
		});
	}

	return visualLines;
};

export const findVisualLineIndex = ({
	offset,
	visualLines,
}: {
	offset: number;
	visualLines: IVisualLine[];
}) => {
	let low = 0;
	let high = visualLines.length - 1;

	while (low <= high) {
		const middle = Math.floor((low + high) / 2);
		const line = visualLines[middle];

		if (!line) {
			break;
		}

		const softWrapBoundary =
			offset === line.endOffset &&
			!line.hardBreak &&
			middle < visualLines.length - 1;

		if (offset < line.startOffset) {
			high = middle - 1;
			continue;
		}

		if (offset > line.endOffset || softWrapBoundary) {
			low = middle + 1;
			continue;
		}

		return middle;
	}

	return Math.max(0, Math.min(low, visualLines.length - 1));
};

export const getSegmentsInLine = ({
	graphemes,
	line,
}: {
	graphemes: IGraphemeSegment[];
	line: IVisualLine;
}) =>
	graphemes.filter(
		(grapheme) =>
			grapheme.segment !== '\n' &&
			grapheme.index >= line.startOffset &&
			grapheme.index < line.endOffset,
	);

export const getVisualPosition = ({
	displayUnits,
	offset,
	visualLines,
}: {
	displayUnits: IDisplayUnit[];
	offset: number;
	visualLines: IVisualLine[];
}): IVisualPosition => {
	const row = findVisualLineIndex({ offset, visualLines });
	const line = visualLines[row];

	if (!line) {
		return { column: 0, row: 0 };
	}

	let column = 0;

	for (const unit of displayUnits) {
		if (unit.rawStart >= line.endOffset) {
			break;
		}

		if (unit.rawEnd <= line.startOffset) {
			continue;
		}

		if (unit.kind === 'text') {
			for (const grapheme of unit.graphemes) {
				if (grapheme.segment === '\n') {
					continue;
				}

				if (grapheme.index < line.startOffset) {
					continue;
				}

				if (grapheme.endOffset > offset) {
					break;
				}

				column += grapheme.width;
			}
		} else {
			// block.rawEnd <= offset → cursor is after the block → add full width
			if (unit.rawEnd <= offset) {
				column += unit.displayWidth;
			}
			// offset === unit.rawStart → cursor is before the block → add nothing
		}
	}

	return { column, row };
};

export const getOffsetFromVisualPosition = ({
	column,
	displayUnits,
	row,
	visualLines,
}: {
	column: number;
	displayUnits: IDisplayUnit[];
	row: number;
	visualLines: IVisualLine[];
}) => {
	const line = visualLines[row];

	if (!line) {
		return 0;
	}

	let columnUsed = 0;

	for (const unit of displayUnits) {
		if (unit.rawStart >= line.endOffset) {
			break;
		}

		if (unit.rawEnd <= line.startOffset) {
			continue;
		}

		if (unit.kind === 'text') {
			for (const grapheme of unit.graphemes) {
				if (grapheme.segment === '\n') {
					continue;
				}

				if (grapheme.index < line.startOffset) {
					continue;
				}

				if (grapheme.index >= line.endOffset) {
					break;
				}

				if (columnUsed + grapheme.width > column) {
					return grapheme.index;
				}

				columnUsed += grapheme.width;
				if (columnUsed >= column) {
					return grapheme.endOffset;
				}
			}
		} else {
			// Block: snap cursor to rawStart if target column is within the block
			if (columnUsed + unit.displayWidth > column) {
				return unit.rawStart;
			}

			columnUsed += unit.displayWidth;
			if (columnUsed >= column) {
				return unit.rawEnd;
			}
		}
	}

	return line.endOffset;
};

// ─── Grapheme Navigation ──────────────────────────────────────────────────────

export const getPreviousGrapheme = ({
	graphemes,
	offset,
}: {
	graphemes: IGraphemeSegment[];
	offset: number;
}) => {
	for (let index = graphemes.length - 1; index >= 0; index -= 1) {
		const grapheme = graphemes[index];

		if (grapheme && grapheme.endOffset <= offset) {
			return grapheme;
		}
	}

	return null;
};

export const getNextGrapheme = ({
	graphemes,
	offset,
}: {
	graphemes: IGraphemeSegment[];
	offset: number;
}) => graphemes.find((grapheme) => grapheme.index >= offset) ?? null;

// ─── Paste Block Helpers ──────────────────────────────────────────────────────

export const isOffsetInsideBlock = (
	offset: number,
	blocks: IPasteBlock[],
): boolean => blocks.some((b) => offset > b.start && offset < b.end);

export const getBlockAtOffset = (
	offset: number,
	blocks: IPasteBlock[],
): IPasteBlock | null =>
	blocks.find((b) => offset >= b.start && offset <= b.end) ?? null;

export const getBlockAtRightEdge = (
	offset: number,
	blocks: IPasteBlock[],
): IPasteBlock | null => blocks.find((b) => b.end === offset) ?? null;

export const getBlockAtLeftEdge = (
	offset: number,
	blocks: IPasteBlock[],
): IPasteBlock | null => blocks.find((b) => b.start === offset) ?? null;

export const shiftBlocksAfter = (
	blocks: IPasteBlock[],
	pos: number,
	delta: number,
): IPasteBlock[] =>
	blocks.map((b) =>
		b.start >= pos ? { end: b.end + delta, start: b.start + delta } : b,
	);

export const removeRangeFromBlocks = (
	blocks: IPasteBlock[],
	pos: number,
	len: number,
): IPasteBlock[] =>
	blocks
		.filter((b) => !(b.start === pos && b.end === pos + len))
		.map((b) =>
			b.start >= pos + len ? { end: b.end - len, start: b.start - len } : b,
		);

// ─── On-demand Layout Snapshot ────────────────────────────────────────────────
//
// Single entry point for deriving all layout data from the three source-of-truth
// values: value string, paste blocks, and terminal column width.
// Used by event handlers that need a guaranteed-fresh snapshot rather than the
// render-time useMemo values (which may be stale when state updates are batched).

export type ITextLayoutSnapshot = {
	displayUnits: IDisplayUnit[];
	graphemes: IGraphemeSegment[];
	visualLines: IVisualLine[];
};

export const buildTextLayoutSnapshot = ({
	columns,
	pasteBlocks,
	value,
}: {
	columns: number | undefined;
	pasteBlocks: IPasteBlock[];
	value: string;
}): ITextLayoutSnapshot => {
	const graphemes = getGraphemeSegments(value);
	const displayUnits = buildDisplayUnits(value, graphemes, pasteBlocks);
	const visualLines =
		columns !== undefined ? buildVisualLines({ columns, displayUnits }) : [];
	return { displayUnits, graphemes, visualLines };
};
