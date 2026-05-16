import { type DOMElement, measureElement, useStdout } from 'ink';
import { useEffect, useRef, useState } from 'react';

const normalizeColumns = (columns?: number) => {
	if (columns === undefined || columns < 1) {
		return undefined;
	}

	return Math.floor(columns);
};

const getMeasuredColumns = (
	element: DOMElement | null,
	stdoutColumns?: number,
) => {
	if (element) {
		const { width } = measureElement(element);
		if (width > 0) {
			return width;
		}
	}

	return normalizeColumns(stdoutColumns);
};

export const useResolvedColumns = (columns?: number) => {
	const { stdout } = useStdout();
	const containerRef = useRef<DOMElement>(null);
	const [resolvedColumns, setResolvedColumns] = useState<number | undefined>(
		normalizeColumns(columns),
	);

	useEffect(() => {
		const normalizedColumns = normalizeColumns(columns);

		if (normalizedColumns !== undefined) {
			setResolvedColumns(normalizedColumns);
			return;
		}

		setResolvedColumns(
			getMeasuredColumns(containerRef.current, stdout?.columns),
		);
	}, [columns, stdout]);

	useEffect(() => {
		if (columns !== undefined) {
			return;
		}

		const handleResize = () => {
			setResolvedColumns(
				getMeasuredColumns(containerRef.current, stdout?.columns),
			);
		};

		stdout?.on('resize', handleResize);
		return () => {
			stdout?.off('resize', handleResize);
		};
	}, [columns, stdout]);

	return { containerRef, resolvedColumns };
};
