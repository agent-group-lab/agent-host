import { Box, Text } from 'ink';
import { observer } from 'mobx-react-lite';
import type { ISessionAgent } from '~/contracts/agent.contract';
import type { SessionStore } from '~/store/session.store';
import { Spinner } from './primitives/spinner';

type IProps = {
	store: SessionStore<ISessionAgent>;
};

export const SessionStreamingText = observer(function SessionStreamingText({
	store,
}: IProps) {
	if (store.streamingText) {
		return (
			<Box flexDirection='column' padding={1}>
				<Text>{store.streamingText}</Text>
			</Box>
		);
	}

	if (store.isProcessing) {
		return (
			<Box padding={1}>
				<Spinner color='yellow' />
			</Box>
		);
	}

	return null;
});
