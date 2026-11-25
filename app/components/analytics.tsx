import { Link, isRouteErrorResponse, useSearchParams } from "react-router";
import {
  ANALYTICS_RANGES,
  type AnalyticsRange,
  type EarningsTimeline,
  type TimelinePeriod,
  type TimelinePoint,
} from "~/lib/analytics";
import { PLATFORM_FEE_RATE, type Earnings } from "~/lib/earnings";
import { cn, formatMoney } from "~/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { AlertTriangle, Receipt } from "lucide-react";

// ─── Instructor Analytics UI ───
// Pieces shared by the analytics roll-up and the per-course deep dive.

export const RANGE_LABELS: Record<AnalyticsRange, string> = {
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  all: "All time",
};

export function parseRange(value: string | null): AnalyticsRange {
  return ANALYTICS_RANGES.find((r) => r === value) ?? "30d";
}

/**
 * `path` carrying the current query string, so the range (and an admin's
 * instructorId) survive moving between the roll-up and a deep dive.
 */
export function useHrefKeepingQuery() {
  const [searchParams] = useSearchParams();
  return (path: string) =>
    searchParams.size > 0 ? `${path}?${searchParams}` : path;
}

/** A `?query` for the current URL with some params replaced or removed. */
export function useHrefWith() {
  const [searchParams] = useSearchParams();
  return (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(updates)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    return `?${next}`;
  };
}

export function RangePicker({ current }: { current: AnalyticsRange }) {
  const hrefWith = useHrefWith();

  return (
    <div
      role="group"
      aria-label="Time range"
      className="inline-flex rounded-lg bg-muted p-1"
    >
      {ANALYTICS_RANGES.map((r) => (
        <Link
          key={r}
          to={hrefWith({ range: r })}
          aria-current={r === current ? "page" : undefined}
          className={cn(
            "rounded-md px-3 py-1 text-sm font-medium transition-colors",
            r === current
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {RANGE_LABELS[r]}
        </Link>
      ))}
    </div>
  );
}

export function EarningsOverview({
  earnings,
  salesCount,
  rangeLabel,
}: {
  earnings: Earnings;
  salesCount: number;
  rangeLabel: string;
}) {
  const feePercent = Math.round(PLATFORM_FEE_RATE * 100);

  return (
    <div className="grid gap-6 sm:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Net earnings · {rangeLabel}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-4xl font-bold tabular-nums">
            {formatMoney(earnings.net)}
          </p>
          <dl className="mt-3 space-y-1 text-sm text-muted-foreground">
            <div className="flex justify-between">
              <dt>Gross revenue</dt>
              <dd className="tabular-nums">{formatMoney(earnings.gross)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Platform fee ({feePercent}%)</dt>
              <dd className="tabular-nums">
                −{formatMoney(earnings.platformFee)}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Sales · {rangeLabel}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-4xl font-bold tabular-nums">{salesCount}</p>
          <p className="mt-3 text-sm text-muted-foreground">
            A team purchase counts as one sale.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

const PERIOD_FORMAT: Record<TimelinePeriod, Intl.DateTimeFormatOptions> = {
  day: { month: "short", day: "numeric" },
  week: { month: "short", day: "numeric" },
  month: { month: "short", year: "numeric" },
};

function formatPeriod(point: TimelinePoint, period: TimelinePeriod) {
  const label = new Date(`${point.start}T00:00:00.000Z`).toLocaleDateString(
    "en-US",
    { ...PERIOD_FORMAT[period], timeZone: "UTC" }
  );
  return period === "week" ? `Week of ${label}` : label;
}

/**
 * Net earnings per period as plain Tailwind bars, with a visually hidden
 * table as the text alternative.
 */
export function EarningsChart({
  timeline,
  rangeLabel,
}: {
  timeline: EarningsTimeline;
  rangeLabel: string;
}) {
  const { period, points } = timeline;
  const max = Math.max(1, ...points.map((p) => p.net));
  const caption = `Net earnings per ${period} · ${rangeLabel}`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {caption}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div aria-hidden="true">
          <div className="mb-1 text-xs tabular-nums text-muted-foreground">
            {formatMoney(max)}
          </div>
          <div className="flex h-40 items-end gap-px border-b border-l pl-px">
            {points.map((point) => (
              <div
                key={point.start}
                title={`${formatPeriod(point, period)}: ${formatMoney(point.net)} net · ${point.salesCount} ${point.salesCount === 1 ? "sale" : "sales"}`}
                className="flex h-full flex-1 items-end hover:bg-muted/60"
              >
                <div
                  className={cn(
                    "w-full rounded-t-sm bg-primary",
                    point.net > 0 && "min-h-px"
                  )}
                  style={{ height: `${(point.net / max) * 100}%` }}
                />
              </div>
            ))}
          </div>
          {points.length > 0 && (
            <div className="mt-1 flex justify-between text-xs text-muted-foreground">
              <span>{formatPeriod(points[0], period)}</span>
              {points.length > 1 && (
                <span>{formatPeriod(points[points.length - 1], period)}</span>
              )}
            </div>
          )}
        </div>
        <table className="sr-only">
          <caption>{caption}</caption>
          <thead>
            <tr>
              <th scope="col">Period</th>
              <th scope="col">Net earnings</th>
              <th scope="col">Sales</th>
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.start}>
                <th scope="row">{formatPeriod(point, period)}</th>
                <td>{formatMoney(point.net)}</td>
                <td>{point.salesCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

export function formatPercent(fraction: number | null) {
  return fraction === null ? "—" : `${Math.round(fraction * 100)}%`;
}

export function StatCard({
  title,
  value,
  note,
}: {
  title: string;
  value: string | number;
  note: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-bold tabular-nums">{value}</p>
        <p className="mt-2 text-sm text-muted-foreground">{note}</p>
      </CardContent>
    </Card>
  );
}

export function StudentsOverview({
  buyerCount,
  studentCount,
  averageProgress,
  completionRate,
  rangeLabel,
}: {
  buyerCount: number;
  studentCount: number;
  averageProgress: number | null;
  completionRate: number | null;
  rangeLabel: string;
}) {
  return (
    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        title={`Buyers · ${rangeLabel}`}
        value={buyerCount}
        note="People who bought, including team purchasers."
      />
      <StatCard
        title={`Students · ${rangeLabel}`}
        value={studentCount}
        note="People who enrolled in this period."
      />
      <StatCard
        title="Average progress"
        value={formatPercent(averageProgress)}
        note="Lessons completed, across every student. Never started counts as 0%."
      />
      <StatCard
        title="Completion rate"
        value={formatPercent(completionRate)}
        note="Enrollments that finished the course."
      />
    </div>
  );
}

export function NoSalesState({ range }: { range: AnalyticsRange }) {
  const hrefWith = useHrefWith();

  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
      <Receipt className="mb-4 size-12 text-muted-foreground/50" />
      <h2 className="text-lg font-medium">
        {range === "all" ? "No sales yet" : "No sales in this period"}
      </h2>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        {range === "all"
          ? "Earnings will appear here once someone buys."
          : "Nobody has bought in this window."}
      </p>
      {range !== "all" && (
        <Link to={hrefWith({ range: "all" })} className="mt-4">
          <Button variant="outline">View all time</Button>
        </Link>
      )}
    </div>
  );
}

export function AnalyticsErrorBoundary({ error }: { error: unknown }) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred while loading your analytics.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 401) {
      title = "Sign in required";
      message =
        typeof error.data === "string"
          ? error.data
          : "Please select a user from the DevUI panel.";
    } else if (error.status === 403) {
      title = "Access denied";
      message =
        typeof error.data === "string"
          ? error.data
          : "You don't have permission to access this page.";
    } else {
      title = `Error ${error.status}`;
      message = typeof error.data === "string" ? error.data : error.statusText;
    }
  }

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="text-center">
        <AlertTriangle className="mx-auto mb-4 size-12 text-muted-foreground" />
        <h1 className="mb-2 text-2xl font-bold">{title}</h1>
        <p className="mb-6 text-muted-foreground">{message}</p>
        <Link to="/">
          <Button>Go Home</Button>
        </Link>
      </div>
    </div>
  );
}
