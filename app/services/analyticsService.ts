import { and, asc, desc, eq, gte, inArray, ne, sql } from "drizzle-orm";
import { db } from "~/db";
import {
  CourseStatus,
  LessonProgressStatus,
  courses,
  enrollments,
  purchases,
  users,
} from "~/db/schema";
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

/** One instructor's id, or "all" for the platform-wide admin view. */
export type AnalyticsScope = number | "all";

/**
 * The courses the analytics cover: published and archived courses — one
 * instructor's own, or every instructor's in "all" mode. Drafts have never
 * been on sale.
 */
function getCourseIdsInScope(scope: AnalyticsScope): number[] {
  return db
    .select({ id: courses.id })
    .from(courses)
    .where(
      and(
        scope === "all" ? undefined : eq(courses.instructorId, scope),
        ne(courses.status, CourseStatus.Draft)
      )
    )
    .all()
    .map((c) => c.id);
}

/**
 * Student figures for the cohort enrolled in range. Progress is lessons
 * completed ÷ lessons in the course, with no duration weighting; students who
 * never started count as 0%. Averages pool every enrollment equally rather
 * than averaging course averages. Completion rate is the share of enrollments
 * with a completion timestamp. Both are null when there are no students.
 */
function getStudentFigures(courseIds: number[], since: string | null) {
  if (courseIds.length === 0) {
    return { count: 0, averageProgress: null, completionRate: null };
  }

  const cohort = db
    .select({
      userId: enrollments.userId,
      completedAt: enrollments.completedAt,
      // Correlated subqueries, written with qualified names: Drizzle drops
      // table qualifiers in a single-table select, which would make them
      // ambiguous inside the subquery.
      totalLessons: sql<number>`(
        select count(*) from lessons l
        inner join modules m on l.module_id = m.id
        where m.course_id = enrollments.course_id
      )`.as("total_lessons"),
      completedLessons: sql<number>`(
        select count(*) from lesson_progress lp
        inner join lessons l on lp.lesson_id = l.id
        inner join modules m on l.module_id = m.id
        where m.course_id = enrollments.course_id
          and lp.user_id = enrollments.user_id
          and lp.status = ${LessonProgressStatus.Completed}
      )`.as("completed_lessons"),
    })
    .from(enrollments)
    .where(
      and(
        inArray(enrollments.courseId, courseIds),
        since ? gte(enrollments.enrolledAt, since) : undefined
      )
    )
    .as("cohort");

  const row = db
    .select({
      count: sql<number>`count(distinct ${cohort.userId})`,
      averageProgress: sql<number | null>`avg(
        case when ${cohort.totalLessons} = 0 then 0.0
        else ${cohort.completedLessons} * 1.0 / ${cohort.totalLessons} end
      )`,
      completionRate: sql<number | null>`avg(
        case when ${cohort.completedAt} is null then 0.0 else 1.0 end
      )`,
    })
    .from(cohort)
    .get()!;

  return row;
}

const TOP_BUYER_LIMIT = 10;

/**
 * The buyers who spent most on the in-scope courses within the range. A solo
 * purchase is one seat; a team purchase is as many seats as coupons it bought.
 */
function getTopBuyers(courseIds: number[], since: string | null) {
  if (courseIds.length === 0) return [];

  const totalSpent = sql<number>`sum(${purchases.amountPaid})`;

  return db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      totalSpent,
      purchaseCount: sql<number>`count(*)`,
      seats: sql<number>`sum(max(1, (
        select count(*) from coupons c where c.purchase_id = purchases.id
      )))`,
      lastPurchaseAt: sql<string>`max(${purchases.createdAt})`,
    })
    .from(purchases)
    .innerJoin(users, eq(purchases.userId, users.id))
    .where(
      and(
        inArray(purchases.courseId, courseIds),
        since ? gte(purchases.createdAt, since) : undefined
      )
    )
    .groupBy(users.id)
    .orderBy(desc(totalSpent), asc(users.id))
    .limit(TOP_BUYER_LIMIT)
    .all();
}

export function getInstructorAnalytics(
  scope: AnalyticsScope,
  range: AnalyticsRange,
  now: Date
) {
  const courseIds = getCourseIdsInScope(scope);
  const since = rangeStart(range, now);

  const sales =
    courseIds.length === 0
      ? { count: 0, buyers: 0, gross: 0 }
      : db
          .select({
            count: sql<number>`count(*)`,
            buyers: sql<number>`count(distinct ${purchases.userId})`,
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

  const students = getStudentFigures(courseIds, since);

  return {
    courseCount: courseIds.length,
    salesCount: sales.count,
    earnings: splitEarnings(sales.gross),
    buyerCount: sales.buyers,
    studentCount: students.count,
    averageProgress: students.averageProgress,
    completionRate: students.completionRate,
    topBuyers: getTopBuyers(courseIds, since),
  };
}
