/** 1 is Monday and 6 is Saturday. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6;

/** 8 is the hour from 08:00 to 09:00, and 16 is the hour from 16:00 to 17:00. */
export const HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16] as const;
export type Hour = (typeof HOURS)[number];

export type HourSlot = { weekday: Weekday; hour: Hour };
