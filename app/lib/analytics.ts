// Instructor Analytics values and types the UI needs. Kept free of database
// imports so the analytics UI can use them in the browser.

export type AnalyticsRange = "30d" | "90d" | "all";

export const ANALYTICS_RANGES: AnalyticsRange[] = ["30d", "90d", "all"];

export type TimelinePeriod = "day" | "week" | "month";

export type TimelinePoint = {
  /** First UTC day of the period, as YYYY-MM-DD. */
  start: string;
  salesCount: number;
  gross: number;
  net: number;
};

export type EarningsTimeline = {
  period: TimelinePeriod;
  points: TimelinePoint[];
};
