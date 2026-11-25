import { and, asc, desc, eq, gte, inArray, ne, sql } from "drizzle-orm";
import { db } from "~/db";
import {
  CourseStatus,
  LessonProgressStatus,
  courses,
  enrollments,
  lessonProgress,
  lessons,
  modules,
  purchases,
  users,
} from "~/db/schema";
import { splitEarnings } from "~/lib/earnings";
import type {
  AnalyticsRange,
  EarningsTimeline,
  TimelinePeriod,
  TimelinePoint,
} from "~/lib/analytics";

export type { AnalyticsRange };

// ─── Analytics Service ───
// Instructor Analytics figures, computed live from purchases, enrollments and
// lesson progress. Uses positional parameters (project convention).

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
 * been on sale. Pass `courseId` to look for just that one.
 */
function getCoursesInScope(scope: AnalyticsScope, courseId?: number) {
  return db
    .select({ id: courses.id, title: courses.title })
    .from(courses)
    .where(
      and(
        scope === "all" ? undefined : eq(courses.instructorId, scope),
        ne(courses.status, CourseStatus.Draft),
        courseId === undefined ? undefined : eq(courses.id, courseId)
      )
    )
    .orderBy(asc(courses.title), asc(courses.id))
    .all();
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

/** Purchases of the given courses made since the start of the range. */
function purchasesInScope(courseIds: number[], since: string | null) {
  return and(
    inArray(purchases.courseId, courseIds),
    since ? gte(purchases.createdAt, since) : undefined
  );
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
    .where(purchasesInScope(courseIds, since))
    .groupBy(users.id)
    .orderBy(desc(totalSpent), asc(users.id))
    .limit(TOP_BUYER_LIMIT)
    .all();
}

/** Sales and buyer figures for purchases of the given courses in range. */
function getSalesFigures(courseIds: number[], since: string | null) {
  if (courseIds.length === 0) return { count: 0, buyers: 0, gross: 0 };

  return db
    .select({
      count: sql<number>`count(*)`,
      buyers: sql<number>`count(distinct ${purchases.userId})`,
      gross: sql<number>`coalesce(sum(${purchases.amountPaid}), 0)`,
    })
    .from(purchases)
    .where(purchasesInScope(courseIds, since))
    .get()!;
}

/** The headline figures for a set of courses — shared by every view. */
function getHeadlineFigures(courseIds: number[], since: string | null) {
  const sales = getSalesFigures(courseIds, since);
  const students = getStudentFigures(courseIds, since);

  return {
    salesCount: sales.count,
    earnings: splitEarnings(sales.gross),
    buyerCount: sales.buyers,
    studentCount: students.count,
    averageProgress: students.averageProgress,
    completionRate: students.completionRate,
  };
}

const RANGE_PERIOD: Record<AnalyticsRange, TimelinePeriod> = {
  "30d": "day",
  "90d": "week",
  all: "month",
};

/** The UTC day of a date, as YYYY-MM-DD. */
function utcDay(date: Date) {
  return date.toISOString().slice(0, 10);
}

/** Midnight UTC at the start of the period containing `date`. Weeks start on Monday. */
function periodStart(date: Date, period: TimelinePeriod) {
  const start = new Date(`${utcDay(date)}T00:00:00.000Z`);
  if (period === "week") {
    const daysSinceMonday = (start.getUTCDay() + 6) % 7;
    start.setUTCDate(start.getUTCDate() - daysSinceMonday);
  }
  if (period === "month") start.setUTCDate(1);
  return start;
}

const PERIOD_DAYS = { day: 1, week: 7 } as const;

function nextPeriod(start: Date, period: TimelinePeriod) {
  const next = new Date(start);
  if (period === "month") next.setUTCMonth(next.getUTCMonth() + 1);
  else next.setUTCDate(next.getUTCDate() + PERIOD_DAYS[period]);
  return next;
}

/**
 * Sales and net earnings per period across the range: daily for 30 days,
 * weekly for 90 days and monthly for all time (from the first sale's month).
 * Periods are UTC, and those without sales are zero-filled.
 */
function getEarningsTimeline(
  courseIds: number[],
  range: AnalyticsRange,
  now: Date
): EarningsTimeline {
  const period = RANGE_PERIOD[range];
  const since = rangeStart(range, now);
  const purchaseDay = sql<string>`substr(${purchases.createdAt}, 1, 10)`;
  const salesByDay =
    courseIds.length === 0
      ? []
      : db
          .select({
            day: purchaseDay,
            count: sql<number>`count(*)`,
            gross: sql<number>`sum(${purchases.amountPaid})`,
          })
          .from(purchases)
          .where(purchasesInScope(courseIds, since))
          .groupBy(purchaseDay)
          .orderBy(purchaseDay)
          .all();

  const firstDay = since ?? salesByDay[0]?.day;
  if (!firstDay) return { period, points: [] };

  const salesByPeriod = new Map<string, { count: number; gross: number }>();
  for (const row of salesByDay) {
    const key = utcDay(periodStart(new Date(row.day), period));
    const total = salesByPeriod.get(key) ?? { count: 0, gross: 0 };
    salesByPeriod.set(key, {
      count: total.count + row.count,
      gross: total.gross + row.gross,
    });
  }

  // Net is taken off the running gross so the platform fee is still rounded
  // once overall: the periods add up exactly to the headline net.
  const points: TimelinePoint[] = [];
  let runningGross = 0;
  let runningNet = 0;
  for (
    let start = periodStart(new Date(firstDay), period);
    start <= now;
    start = nextPeriod(start, period)
  ) {
    const key = utcDay(start);
    const periodSales = salesByPeriod.get(key);
    const gross = periodSales?.gross ?? 0;
    runningGross += gross;
    const net = splitEarnings(runningGross).net - runningNet;
    runningNet += net;
    points.push({
      start: key,
      salesCount: periodSales?.count ?? 0,
      gross,
      net,
    });
  }

  return { period, points };
}

export function getInstructorAnalytics(
  scope: AnalyticsScope,
  range: AnalyticsRange,
  now: Date
) {
  const inScope = getCoursesInScope(scope);
  const courseIds = inScope.map((c) => c.id);
  const since = rangeStart(range, now);

  return {
    courseCount: courseIds.length,
    ...getHeadlineFigures(courseIds, since),
    earningsTimeline: getEarningsTimeline(courseIds, range, now),
    topBuyers: getTopBuyers(courseIds, since),
    courses: inScope.map((course) => ({
      courseId: course.id,
      title: course.title,
      ...getHeadlineFigures([course.id], since),
    })),
  };
}

/**
 * The deep dive for one course, or null when it is a draft, missing, or
 * outside the scope (another instructor's course).
 */
export function getCourseAnalytics(
  scope: AnalyticsScope,
  courseId: number,
  range: AnalyticsRange,
  now: Date
) {
  const [course] = getCoursesInScope(scope, courseId);
  if (!course) return null;
  const since = rangeStart(range, now);

  return {
    course,
    ...getHeadlineFigures([course.id], since),
    earningsTimeline: getEarningsTimeline([course.id], range, now),
    dropOff: getDropOff(course.id, since),
  };
}

// ─── Drop-off (experimental) ───
// Self-contained so it can be reworked or removed after evaluation.

export type DropOffBucket =
  | { kind: "never_started"; label: string; count: number }
  | {
      kind: "lesson";
      lessonId: number;
      label: string;
      moduleTitle: string;
      count: number;
    }
  | { kind: "finished"; label: string; count: number };

/**
 * Buckets each student enrolled in range by their furthest completed lesson in
 * course order (module position, then lesson position). Students who completed
 * the course are "Finished"; those with no completed lesson "Never started".
 * Skip-ahead students land at their furthest lesson — an accepted quirk. The
 * most-stopped lesson ignores the never-started and finished buckets.
 */
function getDropOff(courseId: number, since: string | null) {
  const courseLessons = db
    .select({
      id: lessons.id,
      title: lessons.title,
      moduleTitle: modules.title,
    })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(eq(modules.courseId, courseId))
    .orderBy(asc(modules.position), asc(lessons.position), asc(lessons.id))
    .all();

  const cohort = db
    .select({
      userId: enrollments.userId,
      completedAt: enrollments.completedAt,
    })
    .from(enrollments)
    .where(
      and(
        eq(enrollments.courseId, courseId),
        since ? gte(enrollments.enrolledAt, since) : undefined
      )
    )
    .all();

  const lessonIndex = new Map(courseLessons.map((l, i) => [l.id, i]));
  const furthest = new Map<number, number>();

  if (courseLessons.length > 0 && cohort.length > 0) {
    const completions = db
      .select({
        userId: lessonProgress.userId,
        lessonId: lessonProgress.lessonId,
      })
      .from(lessonProgress)
      .where(
        and(
          eq(lessonProgress.status, LessonProgressStatus.Completed),
          inArray(lessonProgress.lessonId, [...lessonIndex.keys()]),
          inArray(
            lessonProgress.userId,
            cohort.map((c) => c.userId)
          )
        )
      )
      .all();

    for (const { userId, lessonId } of completions) {
      const index = lessonIndex.get(lessonId)!;
      furthest.set(userId, Math.max(furthest.get(userId) ?? -1, index));
    }
  }

  let neverStarted = 0;
  let finished = 0;
  const lessonCounts = courseLessons.map(() => 0);

  for (const { userId, completedAt } of cohort) {
    const index = furthest.get(userId);
    if (completedAt) finished++;
    else if (index === undefined) neverStarted++;
    else lessonCounts[index]++;
  }

  const buckets: DropOffBucket[] = [
    { kind: "never_started", label: "Never started", count: neverStarted },
    ...courseLessons.map((l, i) => ({
      kind: "lesson" as const,
      lessonId: l.id,
      label: l.title,
      moduleTitle: l.moduleTitle,
      count: lessonCounts[i],
    })),
    { kind: "finished", label: "Finished", count: finished },
  ];

  // Earliest lesson wins a tie.
  const top = Math.max(0, ...lessonCounts);
  const mostStoppedLessonId =
    top === 0 ? null : courseLessons[lessonCounts.indexOf(top)].id;

  return { buckets, mostStoppedLessonId };
}
