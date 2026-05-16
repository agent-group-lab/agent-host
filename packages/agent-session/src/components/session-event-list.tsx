import { Box } from 'ink';
import { observer } from 'mobx-react-lite';
import type { ISessionAgent } from '~/contracts/agent.contract';
import type { SessionStore } from '~/store/session.store';
import { EventLogEntry } from './event-log-entry';

type IProps = {
	store: SessionStore<ISessionAgent>;
	maxRows: number;
};

export const SessionEventList = observer(function SessionEventList({
	store,
	maxRows,
}: IProps) {
	const visible = store.events.slice(-maxRows);
	return (
		<Box flexDirection='column' gap={1}>
			{visible.map((entry, i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: stable append-only list
				<EventLogEntry entry={entry} key={i} />
			))}
		</Box>
	);
});
