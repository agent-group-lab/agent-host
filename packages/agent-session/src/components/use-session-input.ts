import { useState } from 'react';

export const useSessionInput = ({
	onSubmit,
}: {
	onSubmit: (prompt: string) => Promise<void>;
}) => {
	const [inputValue, setInputValue] = useState('');

	const handleChange = (value: string) => setInputValue(value);

	const handleSubmit = () => {
		const prompt = inputValue.trim();
		if (!prompt) {
			return;
		}
		setInputValue('');
		return onSubmit(prompt);
	};

	return { inputValue, handleChange, handleSubmit };
};
