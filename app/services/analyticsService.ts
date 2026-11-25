import { and, eq, gte, inArray, ne, sql } from "drizzle-orm";
import { db } from "~/db";
import { CourseStatus, courses, purchases } from "~/db/schema";
import { splitEarnings } from "~/lib/earnings";

// ─── Analytics Service ───
// Instructor Analytics figures, computed live from purchases, enrollments and
// lesson progress. Uses positional parameters (project convention).

export type AnalyticsRange = "30d" | "90d" | "all";

export const ANALYTICS_RANGES: AnalyticsRange[] = ["30d", "90d", "all"];

const RANGE_DAYS: Record<Exclude<AnalyticsRange, "all">, number> = {
  "30d": 30,
  "90d": 90,
};

/** ISO timestamp the range starts at, or null for all time. */
function rangeStart(range: AnalyticsRange, now: Date): string | null {
  if (range === "all") return null;
  const start = new Date(
    now.getTime() - RANGE_DAYS[range] * 24 * 60 * 60 * 1000
  );
  return start.toISOString();
}

/**
 * The courses an instructor's analytics cover: their own published and
 * archived courses. Drafts have never been on sale.
 */
function getCourseIdsInScope(instructorId: number): number[] {
  return db
    .select({ id: courses.id })
    .from(courses)
    .where(
      and(
        eq(courses.instructorId, instructorId),
        ne(courses.status, CourseStatus.Draft)
      )
    )
    .all()
    .map((c) => c.id);
}

export function getInstructorAnalytics(
  instructorId: number,
  range: AnalyticsRange,
  now: Date
) {
  const courseIds = getCourseIdsInScope(instructorId);
  const since = rangeStart(range, now);

  const sales =
    courseIds.length === 0
      ? { count: 0, gross: 0 }
      : db
          .select({
            count: sql<number>`count(*)`,
            gross: sql<number>`coalesce(sum(${purchases.amountPaid}), 0)`,
          })
          .from(purchases)
          .where(
            and(
              inArray(purchases.courseId, courseIds),
              since ? gte(purchases.createdAt, since) : undefined
            )
          )
          .get()!;

  return {
    courseCount: courseIds.length,
    salesCount: sales.count,
    earnings: splitEarnings(sales.gross),
  };
}
