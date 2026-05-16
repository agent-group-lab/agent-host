import { Text } from 'ink';
import { useEffect, useState } from 'react';

const DEFAULT_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const DEFAULT_INTERVAL = 80;

type ISpinnerProps = {
	color?: string;
	frames?: string[];
	interval?: number;
};

export function Spinner({
	color,
	frames = DEFAULT_FRAMES,
	interval = DEFAULT_INTERVAL,
}: ISpinnerProps) {
	const [frameIndex, setFrameIndex] = useState(0);

	useEffect(() => {
		const timer = setInterval(() => {
			setFrameIndex((i) => (i + 1) % frames.length);
		}, interval);
		return () => clearInterval(timer);
	}, [frames, interval]);

	return <Text color={color}>{frames[frameIndex]}</Text>;
}
