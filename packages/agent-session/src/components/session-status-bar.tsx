import { Box, Text } from 'ink';
import { observer } from 'mobx-react-lite';
import type { ISessionAgent } from '~/contracts/agent.contract';
import type { ISessionStatus } from '~/contracts/status.contract';
import type { SessionStore } from '~/store/session.store';
import { Spinner } from './primitives/spinner';

const STATUS_DOT_COLOR: Record<ISessionStatus, string> = {
	idle: 'gray',
	starting: 'yellow',
	running: 'green',
	disconnected: 'yellow',
	rejected: 'red',
	error: 'red',
};

type IProps = { store: SessionStore<ISessionAgent> };

export const SessionStatusBar = observer(function SessionStatusBar({
	store,
}: IProps) {
	const dotColor = STATUS_DOT_COLOR[store.status] ?? 'gray';

	if (store.status === 'disconnected') {
		const info = store.reconnectInfo;
		const label = info
			? `reconnecting (${info.attempt}/${info.maxAttempts})…`
			: 'reconnecting…';
		return (
			<Box gap={1}>
				<Spinner color={dotColor} />
				<Text color={dotColor}>{label}</Text>
			</Box>
		);
	}

	if (store.status === 'rejected') {
		return (
			<Box gap={1}>
				<Text color={dotColor}>✕</Text>
				<Text color={dotColor}>{store.rejectedReason ?? 'rejected'}</Text>
			</Box>
		);
	}

	return (
		<Box gap={1}>
			<Text color={dotColor}>●</Text>
			<Text dimColor>{store.status}</Text>
		</Box>
	);
});
