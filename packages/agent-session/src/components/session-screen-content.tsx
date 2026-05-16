import { Box, useStdout } from 'ink';
import { observer } from 'mobx-react-lite';
import type { ISessionAgent } from '~/contracts/agent.contract';
import type { SessionStore } from '~/store/session.store';
import { SessionEventList } from './session-event-list';
import { SessionInputBar } from './session-input-bar';
import { SessionStatusBar } from './session-status-bar';
import { SessionStreamingText } from './session-streaming-text';

type IProps = {
	store: SessionStore<ISessionAgent>;
	onSubmit: (prompt: string) => Promise<void>;
	onCancel: () => void;
	onError?: (err: Error) => void;
	inputPlaceholder?: string;
};

export const SessionScreenContent = observer(function SessionScreenContent({
	store,
	onSubmit,
	onCancel,
	onError,
	inputPlaceholder,
}: IProps) {
	const { stdout } = useStdout();
	const terminalRows = stdout?.rows ?? 24;
	// reserve 14 rows for UI overhead, rest for event log
	const logRows = Math.max(4, terminalRows - 14);

	return (
		<Box flexDirection='column' width='100%'>
			{store.hasContent && (
				<Box>
					<Box flexDirection='column' overflow='hidden' width='100%'>
						<SessionEventList maxRows={logRows} store={store} />
						<SessionStreamingText store={store} />
					</Box>
				</Box>
			)}
			<SessionInputBar
				onCancel={onCancel}
				onError={onError}
				onSubmit={onSubmit}
				placeholder={inputPlaceholder}
				store={store}
			/>
			<SessionStatusBar store={store} />
		</Box>
	);
});
