import { Link, useNavigate } from "react-router";
import type { Route } from "./+types/instructor.analytics";
import { requireInstructorOrAdmin } from "~/lib/access.server";
import {
  getInstructorAnalytics,
  type AnalyticsScope,
} from "~/services/analyticsService";
import { getUsersByRole } from "~/services/userService";
import { UserRole } from "~/db/schema";
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
import {
  AnalyticsErrorBoundary,
  EarningsOverview,
  NoSalesState,
  RANGE_LABELS,
  RangePicker,
  StudentsOverview,
  formatPercent,
  parseRange,
  useHrefKeepingQuery,
  useHrefWith,
} from "~/components/analytics";
import { BarChart3, ChevronRight, Plus, Users } from "lucide-react";

export function meta() {
  return [
    { title: "Analytics — Cadence" },
    { name: "description", content: "How your courses are performing" },
  ];
}

type InstructorOption = { id: number; name: string };
type Analytics = ReturnType<typeof getInstructorAnalytics>;
type TopBuyer = Analytics["topBuyers"][number];
type CourseRow = Analytics["courses"][number];

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
            <TabsTrigger value="courses">Courses</TabsTrigger>
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
          <TabsContent value="courses" className="mt-4">
            <CoursesTable courses={analytics.courses} rangeLabel={rangeLabel} />
          </TabsContent>
          <TabsContent value="top-buyers" className="mt-4">
            <TopBuyers buyers={analytics.topBuyers} rangeLabel={rangeLabel} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
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

function CoursesTable({
  courses,
  rangeLabel,
}: {
  courses: CourseRow[];
  rangeLabel: string;
}) {
  const navigate = useNavigate();
  const hrefKeepingQuery = useHrefKeepingQuery();
  const th =
    "px-4 py-3 text-xs font-medium uppercase tracking-wider text-muted-foreground";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">
          By course · {rangeLabel}
        </CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className={cn(th, "text-left")}>Course</th>
              <th className={cn(th, "text-right")}>Net earnings</th>
              <th className={cn(th, "text-right")}>Sales</th>
              <th className={cn(th, "text-right")}>Buyers</th>
              <th className={cn(th, "text-right")}>Students</th>
              <th className={cn(th, "text-right")}>Avg. progress</th>
              <th className={cn(th, "text-right")}>Completion</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {courses.map((course) => {
              const href = hrefKeepingQuery(
                `/instructor/analytics/${course.courseId}`
              );
              return (
                <tr
                  key={course.courseId}
                  onClick={() => navigate(href)}
                  className="cursor-pointer border-b transition-colors last:border-0 hover:bg-muted/50"
                >
                  <td className="px-4 py-3 font-medium">
                    <Link
                      to={href}
                      onClick={(e) => e.stopPropagation()}
                      className="hover:underline"
                    >
                      {course.title}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums">
                    {formatMoney(course.earnings.net)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {course.salesCount}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {course.buyerCount}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {course.studentCount}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatPercent(course.averageProgress)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatPercent(course.completionRate)}
                  </td>
                  <td className="pr-4 text-muted-foreground">
                    <ChevronRight className="size-4" />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
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
  return <AnalyticsErrorBoundary error={error} />;
}
