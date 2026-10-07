import { z } from 'zod';

/** Query strings give `string | string[]`; this accepts either as a list. */
export const queryList = <T extends z.ZodType>(item: T) =>
  z.preprocess((v) => (v === undefined || v === '' ? undefined : Array.isArray(v) ? v : String(v).split(',')), z.array(item).optional());

export const queryNumber = () => z.preprocess((v) => (v === undefined || v === '' ? undefined : Number(v)), z.number().finite().optional());

export const queryBool = () => z.preprocess((v) => (v === undefined ? undefined : v === 'true' || v === '1'), z.boolean().optional());
