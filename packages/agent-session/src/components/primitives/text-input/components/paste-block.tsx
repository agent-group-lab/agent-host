import { Text } from 'ink';

type IPasteBlockProps = {
	charCount: number;
};

export const PasteBlock = ({ charCount }: IPasteBlockProps) => (
	<Text color='cyan'>{`[Pasted ${charCount} chars]`}</Text>
);
