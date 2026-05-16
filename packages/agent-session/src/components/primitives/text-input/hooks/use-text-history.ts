import { useState } from 'react';
import type { IPasteBlock } from '../lib/text-layout';

const MAX_HISTORY_SIZE = 100;

type IHistoryEntry = {
	value: string;
	blocks: IPasteBlock[];
};

type IUseTextHistoryOptions = {
	currentBlocks: IPasteBlock[];
	enabled: boolean;
	onChange: (value: string) => void;
	onNavigate: (entry: IHistoryEntry) => void;
	originalValue: string;
};

export const useTextHistory = ({
	currentBlocks,
	enabled,
	onChange,
	onNavigate,
	originalValue,
}: IUseTextHistoryOptions) => {
	const [historyEntries, setHistoryEntries] = useState<IHistoryEntry[]>([]);
	const [historyIndex, setHistoryIndex] = useState<number | null>(null);
	const [draftBeforeHistory, setDraftBeforeHistory] =
		useState<IHistoryEntry | null>(null);

	const showHistoryEntry = (index: number) => {
		const entry = historyEntries[index];
		if (entry === undefined) {
			return;
		}

		onChange(entry.value);
		onNavigate(entry);
		setHistoryIndex(index);
	};

	const restoreDraft = () => {
		const draft = draftBeforeHistory ?? { blocks: [], value: '' };
		onChange(draft.value);
		onNavigate(draft);
		setHistoryIndex(null);
		setDraftBeforeHistory(null);
	};

	const commitHistory = (value: string, blocks: IPasteBlock[]) => {
		if (!enabled) {
			return;
		}

		setHistoryIndex(null);
		setDraftBeforeHistory(null);

		if (value.length === 0) {
			return;
		}

		setHistoryEntries((previousEntries) => {
			const lastEntry = previousEntries.at(-1);
			if (lastEntry?.value === value) {
				return previousEntries;
			}

			return [...previousEntries, { blocks, value }].slice(-MAX_HISTORY_SIZE);
		});
	};

	const enterHistoryFromTop = () => {
		if (!enabled || historyEntries.length === 0) {
			return false;
		}

		if (historyIndex === null) {
			setDraftBeforeHistory({ blocks: currentBlocks, value: originalValue });
			showHistoryEntry(historyEntries.length - 1);
			return true;
		}

		if (historyIndex === 0) {
			return false;
		}

		showHistoryEntry(historyIndex - 1);
		return true;
	};

	const moveHistoryDownOrRestoreDraft = () => {
		if (!enabled || historyIndex === null) {
			return false;
		}

		if (historyIndex < historyEntries.length - 1) {
			showHistoryEntry(historyIndex + 1);
			return true;
		}

		restoreDraft();
		return true;
	};

	return {
		commitHistory,
		enterHistoryFromTop,
		moveHistoryDownOrRestoreDraft,
	};
};
