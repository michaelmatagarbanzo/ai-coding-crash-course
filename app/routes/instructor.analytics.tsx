import { Link, data, isRouteErrorResponse } from "react-router";
import type { Route } from "./+types/instructor.analytics";
import { requireInstructorOrAdmin } from "~/lib/access.server";
import {
  ANALYTICS_RANGES,
  getInstructorAnalytics,
  type AnalyticsRange,
} from "~/services/analyticsService";
import { PLATFORM_FEE_RATE, type Earnings } from "~/lib/earnings";
import { cn, formatMoney } from "~/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { AlertTriangle, BarChart3, Plus, Receipt } from "lucide-react";

export function meta() {
  return [
    { title: "Analytics — Cadence" },
    { name: "description", content: "How your courses are performing" },
  ];
}

const RANGE_LABELS: Record<AnalyticsRange, string> = {
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  all: "All time",
};

function parseRange(value: string | null): AnalyticsRange {
  return ANALYTICS_RANGES.find((r) => r === value) ?? "30d";
}

export async function loader({ request, url }: Route.LoaderArgs) {
  const { userId, isAdmin } = await requireInstructorOrAdmin(request);

  // The admin view (instructor picker) arrives in a follow-up ticket.
  if (isAdmin) {
    throw data("Only instructors can access this page.", { status: 403 });
  }

  const range = parseRange(url.searchParams.get("range"));
  const analytics = getInstructorAnalytics(userId, range, new Date());

  return { range, analytics };
}

export function HydrateFallback() {
  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <Skeleton className="h-9 w-48" />
      <Skeleton className="mt-2 h-5 w-72" />
      <div className="mt-8 grid gap-6 sm:grid-cols-2">
        <Skeleton className="h-36" />
        <Skeleton className="h-36" />
      </div>
    </div>
  );
}

export default function InstructorAnalytics({
  loaderData,
}: Route.ComponentProps) {
  const { range, analytics } = loaderData;

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/" className="hover:text-foreground">
          Home
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">Analytics</span>
      </nav>

      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Analytics</h1>
          <p className="mt-1 text-muted-foreground">
            How your courses are performing
          </p>
        </div>
        {analytics.courseCount > 0 && <RangePicker current={range} />}
      </div>

      {analytics.courseCount === 0 ? (
        <NoCoursesState />
      ) : (
        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
          </TabsList>
          <TabsContent value="overview" className="mt-4">
            {analytics.salesCount === 0 ? (
              <NoSalesState range={range} />
            ) : (
              <EarningsOverview
                earnings={analytics.earnings}
                salesCount={analytics.salesCount}
                rangeLabel={RANGE_LABELS[range]}
              />
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

function RangePicker({ current }: { current: AnalyticsRange }) {
  return (
    <div
      role="group"
      aria-label="Time range"
      className="inline-flex rounded-lg bg-muted p-1"
    >
      {ANALYTICS_RANGES.map((r) => (
        <Link
          key={r}
          to={`?range=${r}`}
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

function EarningsOverview({
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

function NoSalesState({ range }: { range: AnalyticsRange }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
      <Receipt className="mb-4 size-12 text-muted-foreground/50" />
      <h2 className="text-lg font-medium">
        {range === "all" ? "No sales yet" : "No sales in this period"}
      </h2>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        {range === "all"
          ? "Earnings will appear here once someone buys one of your courses."
          : "Nobody has bought one of your courses in this window."}
      </p>
      {range !== "all" && (
        <Link to="?range=all" className="mt-4">
          <Button variant="outline">View all time</Button>
        </Link>
      )}
    </div>
  );
}

function NoCoursesState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <BarChart3 className="mb-4 size-12 text-muted-foreground/50" />
      <h2 className="text-lg font-medium">Nothing to report yet</h2>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        Analytics appear once you publish a course. Your earnings, students and
        progress will show up here.
      </p>
      <Link to="/instructor/new" className="mt-4">
        <Button>
          <Plus className="mr-2 size-4" />
          Create Course
        </Button>
      </Link>
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
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
