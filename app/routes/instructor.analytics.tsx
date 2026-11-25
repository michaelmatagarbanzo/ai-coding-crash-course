import {
  Link,
  isRouteErrorResponse,
  useNavigate,
  useSearchParams,
} from "react-router";
import type { Route } from "./+types/instructor.analytics";
import { requireInstructorOrAdmin } from "~/lib/access.server";
import {
  ANALYTICS_RANGES,
  getInstructorAnalytics,
  type AnalyticsRange,
  type AnalyticsScope,
} from "~/services/analyticsService";
import { getUsersByRole } from "~/services/userService";
import { UserRole } from "~/db/schema";
import { PLATFORM_FEE_RATE, type Earnings } from "~/lib/earnings";
import { cn, formatMoney } from "~/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { AlertTriangle, BarChart3, Plus, Receipt, Users } from "lucide-react";

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

type InstructorOption = { id: number; name: string };
type TopBuyer = ReturnType<typeof getInstructorAnalytics>["topBuyers"][number];

function parseRange(value: string | null): AnalyticsRange {
  return ANALYTICS_RANGES.find((r) => r === value) ?? "30d";
}

export async function loader({ request, url }: Route.LoaderArgs) {
  const { userId, isAdmin } = await requireInstructorOrAdmin(request);
  const range = parseRange(url.searchParams.get("range"));

  // Instructors always see their own courses; `instructorId` is admin-only and
  // ignored otherwise. Admins default to the platform-wide view.
  let scope: AnalyticsScope = userId;
  let instructors: InstructorOption[] | null = null;

  if (isAdmin) {
    instructors = getUsersByRole(UserRole.Instructor).map(({ id, name }) => ({
      id,
      name,
    }));
    const requested = url.searchParams.get("instructorId");
    scope = instructors.find((i) => String(i.id) === requested)?.id ?? "all";
  }

  const analytics = getInstructorAnalytics(scope, range, new Date());

  return { range, scope, isAdmin, instructors, analytics };
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
  const { range, scope, isAdmin, instructors, analytics } = loaderData;
  const rangeLabel = RANGE_LABELS[range];

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
            {isAdmin
              ? scope === "all"
                ? "How courses across the platform are performing"
                : `How ${instructors?.find((i) => i.id === scope)?.name}'s courses are performing`
              : "How your courses are performing"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {instructors && (
            <InstructorPicker instructors={instructors} scope={scope} />
          )}
          {analytics.courseCount > 0 && <RangePicker current={range} />}
        </div>
      </div>

      {analytics.courseCount === 0 ? (
        <NoCoursesState isAdmin={isAdmin} />
      ) : (
        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="top-buyers">Top buyers</TabsTrigger>
          </TabsList>
          <TabsContent value="overview" className="mt-4 space-y-6">
            {analytics.salesCount === 0 ? (
              <NoSalesState range={range} />
            ) : (
              <EarningsOverview
                earnings={analytics.earnings}
                salesCount={analytics.salesCount}
                rangeLabel={rangeLabel}
              />
            )}
            <StudentsOverview
              buyerCount={analytics.buyerCount}
              studentCount={analytics.studentCount}
              averageProgress={analytics.averageProgress}
              completionRate={analytics.completionRate}
              rangeLabel={rangeLabel}
            />
          </TabsContent>
          <TabsContent value="top-buyers" className="mt-4">
            <TopBuyers buyers={analytics.topBuyers} rangeLabel={rangeLabel} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

/** A `?query` for the current URL with some params replaced or removed. */
function useHrefWith() {
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

function InstructorPicker({
  instructors,
  scope,
}: {
  instructors: InstructorOption[];
  scope: AnalyticsScope;
}) {
  const navigate = useNavigate();
  const hrefWith = useHrefWith();

  return (
    <Select
      value={String(scope)}
      onValueChange={(value) =>
        navigate(hrefWith({ instructorId: value === "all" ? null : value }))
      }
    >
      <SelectTrigger className="w-52" aria-label="Instructor">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All instructors</SelectItem>
        {instructors.map((i) => (
          <SelectItem key={i.id} value={String(i.id)}>
            {i.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function RangePicker({ current }: { current: AnalyticsRange }) {
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

function formatPercent(fraction: number | null) {
  return fraction === null ? "—" : `${Math.round(fraction * 100)}%`;
}

function StatCard({
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

function StudentsOverview({
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

function TopBuyers({
  buyers,
  rangeLabel,
}: {
  buyers: TopBuyer[];
  rangeLabel: string;
}) {
  if (buyers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
        <Users className="mb-4 size-12 text-muted-foreground/50" />
        <h2 className="text-lg font-medium">No buyers in this period</h2>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          Your biggest customers will be ranked here once people buy.
        </p>
      </div>
    );
  }

  const th =
    "px-4 py-3 text-xs font-medium uppercase tracking-wider text-muted-foreground";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Top {buyers.length} buyers by total spent · {rangeLabel}
        </CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className={cn(th, "text-left")}>#</th>
              <th className={cn(th, "text-left")}>Buyer</th>
              <th className={cn(th, "text-right")}>Total spent</th>
              <th className={cn(th, "text-right")}>Purchases</th>
              <th className={cn(th, "text-right")}>Seats</th>
              <th className={cn(th, "text-right")}>Last purchase</th>
            </tr>
          </thead>
          <tbody>
            {buyers.map((buyer, i) => (
              <tr key={buyer.userId} className="border-b last:border-0">
                <td className="px-4 py-3 tabular-nums text-muted-foreground">
                  {i + 1}
                </td>
                <td className="px-4 py-3">
                  <div className="font-medium">{buyer.name}</div>
                  <div className="text-muted-foreground">{buyer.email}</div>
                </td>
                <td className="px-4 py-3 text-right font-medium tabular-nums">
                  {formatMoney(buyer.totalSpent)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {buyer.purchaseCount}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {buyer.seats}
                </td>
                <td className="px-4 py-3 text-right text-muted-foreground">
                  {new Date(buyer.lastPurchaseAt).toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function NoSalesState({ range }: { range: AnalyticsRange }) {
  const hrefWith = useHrefWith();

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
        <Link to={hrefWith({ range: "all" })} className="mt-4">
          <Button variant="outline">View all time</Button>
        </Link>
      )}
    </div>
  );
}

function NoCoursesState({ isAdmin }: { isAdmin: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <BarChart3 className="mb-4 size-12 text-muted-foreground/50" />
      <h2 className="text-lg font-medium">Nothing to report yet</h2>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        {isAdmin
          ? "There are no published or archived courses in this view yet."
          : "Analytics appear once you publish a course. Your earnings, students and progress will show up here."}
      </p>
      {!isAdmin && (
        <Link to="/instructor/new" className="mt-4">
          <Button>
            <Plus className="mr-2 size-4" />
            Create Course
          </Button>
        </Link>
      )}
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
