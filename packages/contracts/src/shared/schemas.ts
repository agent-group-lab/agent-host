import { z } from 'zod';

export const nonNegativeIntegerSchema = z.number().int().nonnegative();
