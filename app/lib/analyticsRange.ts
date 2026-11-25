// The date ranges Instructor Analytics can be viewed over. Kept free of
// database imports so the analytics UI can use it in the browser.

export type AnalyticsRange = "30d" | "90d" | "all";

export const ANALYTICS_RANGES: AnalyticsRange[] = ["30d", "90d", "all"];
