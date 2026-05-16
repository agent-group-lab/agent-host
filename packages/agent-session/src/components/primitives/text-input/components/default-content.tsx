import { Text } from 'ink';
import { Fragment } from 'react';
import type { IDisplayUnit } from '../lib/text-layout';
import { PasteBlock } from './paste-block';

type IDefaultContentProps = {
	cursorOffset: number;
	displayUnits: IDisplayUnit[];
	focus: boolean;
	placeholder: string;
	value: string;
};

export const DefaultContent = ({
	cursorOffset,
	displayUnits,
	focus,
	placeholder,
	value,
}: IDefaultContentProps) => {
	if (!value) {
		return (
			<Text>
				{focus ? <Text inverse> </Text> : null}
				{placeholder ? <Text dimColor>{placeholder}</Text> : null}
			</Text>
		);
	}

	if (!focus) {
		return (
			<Text>
				{displayUnits.map((unit) =>
					unit.kind === 'block' ? (
						<PasteBlock
							charCount={unit.rawEnd - unit.rawStart}
							key={unit.rawStart}
						/>
					) : (
						<Fragment key={unit.rawStart}>
							{value.slice(unit.rawStart, unit.rawEnd)}
						</Fragment>
					),
				)}
			</Text>
		);
	}

	// Focused: render with cursor. Iterate display units and inject cursor.
	const nodes: React.ReactNode[] = [];

	for (const unit of displayUnits) {
		if (unit.kind === 'block') {
			// Cursor at block.start → render inverted cursor spacer before the block
			const cursorBeforeBlock = cursorOffset === unit.rawStart;
			nodes.push(
				<Fragment key={unit.rawStart}>
					{cursorBeforeBlock ? <Text inverse> </Text> : null}
					<PasteBlock charCount={unit.rawEnd - unit.rawStart} />
				</Fragment>,
			);
			continue;
		}

		// Text unit: render slice with cursor inserted
		const { rawStart, rawEnd } = unit;

		// A text unit owns the cursor only if it is strictly inside [rawStart, rawEnd)
		// or at the very end of the string. When cursorOffset === rawEnd < value.length
		// the next (block) unit owns the cursor instead.
		if (
			cursorOffset < rawStart ||
			cursorOffset > rawEnd ||
			(cursorOffset === rawEnd && rawEnd < value.length)
		) {
			nodes.push(
				<Fragment key={rawStart}>{value.slice(rawStart, rawEnd)}</Fragment>,
			);
			continue;
		}

		// Cursor falls within this text unit. Use grapheme endOffset so that
		// multi-code-unit clusters (surrogate pairs, ZWJ emoji) are not split.
		const cursorGrapheme = unit.graphemes.find((g) => g.index === cursorOffset);
		const cursorEndOffset = cursorGrapheme?.endOffset ?? cursorOffset + 1;
		const cursorChar = value[cursorOffset] ?? ' ';
		const cursorNeedsSpacer =
			cursorOffset === value.length || cursorChar === '\n';
		const cursorAtLineBreak = cursorChar === '\n';

		nodes.push(
			<Fragment key={rawStart}>
				{value.slice(rawStart, cursorOffset)}
				<Text inverse>
					{cursorNeedsSpacer || cursorAtLineBreak
						? ' '
						: value.slice(cursorOffset, cursorEndOffset)}
				</Text>
				{cursorNeedsSpacer
					? null
					: cursorAtLineBreak
						? value.slice(cursorOffset, rawEnd)
						: value.slice(cursorEndOffset, rawEnd)}
			</Fragment>,
		);
	}

	return <Text>{nodes}</Text>;
};
