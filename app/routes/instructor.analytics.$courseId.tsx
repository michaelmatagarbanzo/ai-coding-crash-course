import { Link, data } from "react-router";
import type { Route } from "./+types/instructor.analytics.$courseId";
import { requireStaff } from "~/lib/access.server";
import {
  getCourseAnalytics,
  type DropOffBucket,
} from "~/services/analyticsService";
import { cn } from "~/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import {
  AnalyticsErrorBoundary,
  EarningsChart,
  EarningsOverview,
  NoSalesState,
  RANGE_LABELS,
  RangePicker,
  StudentsOverview,
  parseRange,
  useHrefKeepingQuery,
} from "~/components/analytics";

export function meta({ loaderData }: Route.MetaArgs) {
  const title = loaderData?.analytics.course.title ?? "Course";
  return [
    { title: `Analytics: ${title} — Cadence` },
    { name: "description", content: `How ${title} is performing` },
  ];
}

export async function loader({ request, params, url }: Route.LoaderArgs) {
  const courseId = Number(params.courseId);
  if (!Number.isInteger(courseId)) {
    throw data("Course not found.", { status: 404 });
  }

  // 403 unless this is the course's own instructor, or an admin.
  const { userId, isAdmin } = await requireStaff(request, courseId);
  const range = parseRange(url.searchParams.get("range"));

  const analytics = getCourseAnalytics(
    isAdmin ? "all" : userId!,
    courseId,
    range,
    new Date()
  );
  // Drafts have no analytics.
  if (!analytics) throw data("Course not found.", { status: 404 });

  return { range, analytics };
}

export function HydrateFallback() {
  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <Skeleton className="h-9 w-64" />
      <Skeleton className="mt-2 h-5 w-48" />
      <div className="mt-8 grid gap-6 sm:grid-cols-2">
        <Skeleton className="h-36" />
        <Skeleton className="h-36" />
      </div>
    </div>
  );
}

export default function CourseAnalytics({ loaderData }: Route.ComponentProps) {
  const { range, analytics } = loaderData;
  const rangeLabel = RANGE_LABELS[range];
  const backHref = useHrefKeepingQuery()("/instructor/analytics");

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/" className="hover:text-foreground">
          Home
        </Link>
        <span className="mx-2">/</span>
        <Link to={backHref} className="hover:text-foreground">
          Analytics
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">{analytics.course.title}</span>
      </nav>

      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">{analytics.course.title}</h1>
          <p className="mt-1 text-muted-foreground">
            How this course is performing
          </p>
        </div>
        <RangePicker current={range} />
      </div>

      <div className="space-y-6">
        {analytics.salesCount === 0 ? (
          <NoSalesState range={range} />
        ) : (
          <>
            <EarningsOverview
              earnings={analytics.earnings}
              salesCount={analytics.salesCount}
              rangeLabel={rangeLabel}
            />
            <EarningsChart
              timeline={analytics.earningsTimeline}
              rangeLabel={rangeLabel}
            />
          </>
        )}
        <StudentsOverview
          buyerCount={analytics.buyerCount}
          studentCount={analytics.studentCount}
          averageProgress={analytics.averageProgress}
          completionRate={analytics.completionRate}
          rangeLabel={rangeLabel}
        />
        <DropOffPanel
          buckets={analytics.dropOff.buckets}
          mostStoppedLessonId={analytics.dropOff.mostStoppedLessonId}
          rangeLabel={rangeLabel}
        />
      </div>
    </div>
  );
}

// ─── Drop-off (experimental) ───
// Self-contained so it can be reworked or removed after evaluation.

function DropOffPanel({
  buckets,
  mostStoppedLessonId,
  rangeLabel,
}: {
  buckets: DropOffBucket[];
  mostStoppedLessonId: number | null;
  rangeLabel: string;
}) {
  const max = Math.max(1, ...buckets.map((b) => b.count));
  const total = buckets.reduce((sum, b) => sum + b.count, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          Where students stop · {rangeLabel}
          <span className="rounded-full border px-2 py-0.5 text-xs font-medium">
            Experimental
          </span>
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Each student enrolled in this period, placed at the furthest lesson
          they completed. Students who skip ahead count at their furthest
          lesson.
        </p>
      </CardHeader>
      <CardContent>
        {total === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Nobody enrolled in this period.
          </p>
        ) : (
          <ol className="space-y-2">
            {buckets.map((bucket) => {
              const highlighted =
                bucket.kind === "lesson" &&
                bucket.lessonId === mostStoppedLessonId;
              return (
                <li
                  key={
                    bucket.kind === "lesson"
                      ? `lesson-${bucket.lessonId}`
                      : bucket.kind
                  }
                  className="grid grid-cols-[minmax(0,16rem)_1fr_3rem] items-center gap-3 text-sm"
                >
                  <div className="min-w-0">
                    {bucket.kind === "lesson" && (
                      <div className="truncate text-xs text-muted-foreground">
                        {bucket.moduleTitle}
                      </div>
                    )}
                    <div
                      className={cn(
                        "truncate",
                        bucket.kind !== "lesson" && "font-medium",
                        highlighted && "font-semibold text-destructive"
                      )}
                    >
                      {bucket.label}
                    </div>
                  </div>
                  <div className="h-3 rounded-full bg-muted">
                    <div
                      className={cn(
                        "h-3 rounded-full",
                        highlighted ? "bg-destructive" : "bg-primary"
                      )}
                      style={{ width: `${(bucket.count / max) * 100}%` }}
                    />
                  </div>
                  <div className="text-right tabular-nums">
                    {bucket.count}
                    {highlighted && <span className="sr-only"> (most stopped)</span>}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        {mostStoppedLessonId !== null && (
          <p className="mt-4 text-sm text-muted-foreground">
            <span className="font-medium text-destructive">Highlighted:</span>{" "}
            the lesson where most students stopped, not counting those who
            never started or finished.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <AnalyticsErrorBoundary error={error} />;
}
