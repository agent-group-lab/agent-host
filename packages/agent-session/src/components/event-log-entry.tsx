import { Box, Text } from 'ink';
import type { IEventLogEntry } from '~/contracts/event-log.contract';

export function EventLogEntry({ entry }: { entry: IEventLogEntry }) {
	if (entry.kind === 'prompt') {
		return (
			<Box backgroundColor='#ededed' padding={1}>
				<Text bold color='gray'>
					{'> '}
				</Text>
				<Text>{entry.content}</Text>
			</Box>
		);
	}
	if (entry.kind === 'text') {
		return (
			<Box flexDirection='column' paddingX={1}>
				<Text>{entry.content}</Text>
			</Box>
		);
	}
	if (entry.kind === 'tool') {
		if (!entry.done) {
			return (
				<Box paddingX={1}>
					<Text color='yellow'>{'[tool] '}</Text>
					<Text dimColor>{entry.toolName}…</Text>
				</Box>
			);
		}
		return (
			<Box paddingX={1}>
				<Text color={entry.isError ? 'red' : 'green'}>{'[tool] '}</Text>
				<Text dimColor>{entry.toolName}</Text>
				{entry.isError && <Text color='red'>{' ✗'}</Text>}
			</Box>
		);
	}
	if (entry.kind === 'file') {
		const opColor =
			entry.operation === 'add'
				? 'green'
				: entry.operation === 'delete'
					? 'red'
					: 'yellow';
		return (
			<Box paddingX={1}>
				<Text color={opColor}>{`[${entry.operation}] `}</Text>
				<Text dimColor>{entry.filePath}</Text>
			</Box>
		);
	}
	if (entry.kind === 'error') {
		return (
			<Box paddingX={1}>
				<Text color='red'>{'[error] '}</Text>
				<Text>{entry.message}</Text>
			</Box>
		);
	}
	return null;
}
