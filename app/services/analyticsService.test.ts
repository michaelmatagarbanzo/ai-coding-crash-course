import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";

let testDb: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

// Import after mock so the module picks up our test db
import {
  getCourseAnalytics,
  getInstructorAnalytics,
  type AnalyticsRange,
} from "./analyticsService";

const NOW = new Date("2026-06-30T12:00:00.000Z");

function daysBefore(days: number) {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

function addPurchase(
  courseId: number,
  amountPaid: number,
  daysAgo = 1,
  userId = base.user.id
) {
  return testDb
    .insert(schema.purchases)
    .values({
      userId,
      courseId,
      amountPaid,
      country: "US",
      createdAt: daysBefore(daysAgo),
    })
    .returning()
    .get();
}

let userCounter = 0;

function addUser(
  name = `Student ${++userCounter}`,
  role: schema.UserRole = schema.UserRole.Student
) {
  return testDb
    .insert(schema.users)
    .values({
      name,
      email: `${name.toLowerCase().replace(/\s+/g, "-")}@example.com`,
      role,
    })
    .returning()
    .get();
}

/** A team purchase: one purchase row plus one coupon per seat. */
function addTeamPurchase(
  courseId: number,
  amountPaid: number,
  seats: number,
  daysAgo = 1,
  userId = base.user.id
) {
  const purchase = addPurchase(courseId, amountPaid, daysAgo, userId);
  const team = testDb.insert(schema.teams).values({}).returning().get();
  for (let i = 0; i < seats; i++) {
    testDb
      .insert(schema.coupons)
      .values({
        teamId: team.id,
        courseId,
        purchaseId: purchase.id,
        code: `${purchase.id}-${i}`,
      })
      .run();
  }
  return purchase;
}

function enroll(
  userId: number,
  courseId: number,
  daysAgo = 1,
  completed = false
) {
  testDb
    .insert(schema.enrollments)
    .values({
      userId,
      courseId,
      enrolledAt: daysBefore(daysAgo),
      completedAt: completed ? daysBefore(0) : null,
    })
    .run();
}

/** Adds one module holding `count` lessons and returns the lesson ids. */
function addLessons(
  courseId: number,
  count: number,
  moduleTitle = "Module",
  modulePosition = 1
) {
  const mod = testDb
    .insert(schema.modules)
    .values({ courseId, title: moduleTitle, position: modulePosition })
    .returning()
    .get();
  return Array.from(
    { length: count },
    (_, i) =>
      testDb
        .insert(schema.lessons)
        .values({ moduleId: mod.id, title: `Lesson ${i + 1}`, position: i + 1 })
        .returning()
        .get().id
  );
}

function completeLessons(userId: number, lessonIds: number[]) {
  for (const lessonId of lessonIds) {
    testDb
      .insert(schema.lessonProgress)
      .values({
        userId,
        lessonId,
        status: schema.LessonProgressStatus.Completed,
        completedAt: daysBefore(0),
      })
      .run();
  }
}

function addCourse(
  instructorId: number,
  slug: string,
  status: schema.CourseStatus = schema.CourseStatus.Published
) {
  return testDb
    .insert(schema.courses)
    .values({
      title: slug,
      slug,
      description: "A course",
      salesCopy: "Sales copy.",
      instructorId,
      categoryId: base.category.id,
      status,
    })
    .returning()
    .get();
}

describe("analyticsService", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  describe("getInstructorAnalytics — earnings", () => {
    it("returns zeroed figures for an instructor with no courses", () => {
      const newInstructor = testDb
        .insert(schema.users)
        .values({
          name: "New Instructor",
          email: "new@example.com",
          role: schema.UserRole.Instructor,
        })
        .returning()
        .get();

      const analytics = getInstructorAnalytics(newInstructor.id, "all", NOW);

      expect(analytics).toEqual({
        courseCount: 0,
        salesCount: 0,
        earnings: { gross: 0, platformFee: 0, net: 0 },
        buyerCount: 0,
        studentCount: 0,
        averageProgress: null,
        completionRate: null,
        topBuyers: [],
        courses: [],
      });
    });

    it("splits gross revenue into a 20% platform fee and net earnings", () => {
      addPurchase(base.course.id, 4999);
      addPurchase(base.course.id, 2500);

      const analytics = getInstructorAnalytics(base.instructor.id, "all", NOW);

      // 7499 gross → 1499.8 fee rounds to 1500 → 5999 net
      expect(analytics.courseCount).toBe(1);
      expect(analytics.salesCount).toBe(2);
      expect(analytics.earnings).toEqual({
        gross: 7499,
        platformFee: 1500,
        net: 5999,
      });
    });
    it("includes archived courses and excludes drafts", () => {
      const archived = addCourse(
        base.instructor.id,
        "archived",
        schema.CourseStatus.Archived
      );
      const draft = addCourse(
        base.instructor.id,
        "draft",
        schema.CourseStatus.Draft
      );
      addPurchase(base.course.id, 1000);
      addPurchase(archived.id, 2000);
      addPurchase(draft.id, 4000);

      const analytics = getInstructorAnalytics(base.instructor.id, "all", NOW);

      expect(analytics.courseCount).toBe(2);
      expect(analytics.salesCount).toBe(2);
      expect(analytics.earnings.gross).toBe(3000);
    });

    it("filters earnings by purchase date for the selected range", () => {
      addPurchase(base.course.id, 100, 29);
      addPurchase(base.course.id, 200, 31);
      addPurchase(base.course.id, 400, 89);
      addPurchase(base.course.id, 800, 91);

      const gross = (range: AnalyticsRange) =>
        getInstructorAnalytics(base.instructor.id, range, NOW).earnings.gross;

      expect(gross("30d")).toBe(100);
      expect(gross("90d")).toBe(700);
      expect(gross("all")).toBe(1500);
    });

    it("includes purchases made exactly at the start of the range", () => {
      addPurchase(base.course.id, 100, 30);
      addPurchase(base.course.id, 200, 90);

      const gross = (range: AnalyticsRange) =>
        getInstructorAnalytics(base.instructor.id, range, NOW).earnings.gross;

      expect(gross("30d")).toBe(100);
      expect(gross("90d")).toBe(300);
    });

    it("never counts another instructor's sales", () => {
      const otherInstructor = testDb
        .insert(schema.users)
        .values({
          name: "Other Instructor",
          email: "other@example.com",
          role: schema.UserRole.Instructor,
        })
        .returning()
        .get();
      const otherCourse = addCourse(otherInstructor.id, "other-course");
      addPurchase(base.course.id, 1000);
      addPurchase(otherCourse.id, 9000);

      const analytics = getInstructorAnalytics(base.instructor.id, "all", NOW);

      expect(analytics.salesCount).toBe(1);
      expect(analytics.earnings.gross).toBe(1000);
    });

    it("counts what was actually paid: PPP prices and whole team purchases", () => {
      addPurchase(base.course.id, 1500); // 70% off a 4999 course
      addPurchase(base.course.id, 4999 * 5); // one team purchase of 5 seats

      const analytics = getInstructorAnalytics(base.instructor.id, "all", NOW);

      expect(analytics.salesCount).toBe(2);
      expect(analytics.earnings.gross).toBe(26495);
    });

    it("rounds the platform fee once on the total, not per purchase", () => {
      // Per purchase: 3 × round(0.6) = 3. On the total: round(1.8) = 2.
      addPurchase(base.course.id, 3);
      addPurchase(base.course.id, 3);
      addPurchase(base.course.id, 3);

      const analytics = getInstructorAnalytics(base.instructor.id, "all", NOW);

      expect(analytics.earnings).toEqual({ gross: 9, platformFee: 2, net: 7 });
    });
  });

  describe("getInstructorAnalytics — buyers and students", () => {
    it("counts a team purchase as one buyer and its members as several students", () => {
      const lead = addUser("Team Lead");
      const [a, b, c] = [addUser(), addUser(), addUser()];
      addTeamPurchase(base.course.id, 4999 * 3, 3, 1, lead.id);
      for (const s of [a, b, c]) enroll(s.id, base.course.id);

      const analytics = getInstructorAnalytics(base.instructor.id, "all", NOW);

      expect(analytics.buyerCount).toBe(1);
      expect(analytics.studentCount).toBe(3);
    });

    it("counts buyers by purchase date for the range", () => {
      addPurchase(base.course.id, 1000, 10, addUser().id);
      addPurchase(base.course.id, 1000, 60, addUser().id);

      const buyers = (range: AnalyticsRange) =>
        getInstructorAnalytics(base.instructor.id, range, NOW).buyerCount;

      expect(buyers("30d")).toBe(1);
      expect(buyers("90d")).toBe(2);
    });
  });

  describe("getInstructorAnalytics — progress and completion", () => {
    it("averages lessons completed ÷ total lessons, counting never-started students as 0%", () => {
      const lessons = addLessons(base.course.id, 4);
      const [halfway, allDone, neverStarted] = [
        addUser(),
        addUser(),
        addUser(),
      ];
      for (const s of [halfway, allDone, neverStarted]) {
        enroll(s.id, base.course.id);
      }
      completeLessons(halfway.id, lessons.slice(0, 2));
      completeLessons(allDone.id, lessons);

      const analytics = getInstructorAnalytics(base.instructor.id, "all", NOW);

      // (0.5 + 1 + 0) / 3
      expect(analytics.averageProgress).toBeCloseTo(0.5);
    });

    it("pools every student across courses rather than averaging course averages", () => {
      const small = addCourse(base.instructor.id, "small-course");
      addLessons(base.course.id, 2);
      const smallLessons = addLessons(small.id, 1);

      // Big course: three students at 0%. Small course: one student at 100%.
      for (let i = 0; i < 3; i++) enroll(addUser().id, base.course.id);
      const finisher = addUser();
      enroll(finisher.id, small.id);
      completeLessons(finisher.id, smallLessons);

      const analytics = getInstructorAnalytics(base.instructor.id, "all", NOW);

      // Pooled: (0 + 0 + 0 + 1) / 4 = 25%. A mean of course means would be 50%.
      expect(analytics.averageProgress).toBeCloseTo(0.25);
    });

    it("only counts completed lessons from the student's own course", () => {
      const other = addCourse(base.instructor.id, "other-course");
      addLessons(base.course.id, 2);
      const otherLessons = addLessons(other.id, 2);
      const student = addUser();
      enroll(student.id, base.course.id);
      completeLessons(student.id, otherLessons);

      const analytics = getInstructorAnalytics(base.instructor.id, "all", NOW);

      expect(analytics.averageProgress).toBe(0);
    });

    it("reports the share of enrollments that completed the course", () => {
      addLessons(base.course.id, 1);
      enroll(addUser().id, base.course.id, 1, true);
      for (let i = 0; i < 3; i++) enroll(addUser().id, base.course.id);

      const analytics = getInstructorAnalytics(base.instructor.id, "all", NOW);

      expect(analytics.completionRate).toBeCloseTo(0.25);
    });

    it("selects students by enrollment date for the range, not purchase date", () => {
      const lessons = addLessons(base.course.id, 2);
      const recent = addUser();
      const older = addUser();
      // The recent student bought long ago but only enrolled recently.
      addPurchase(base.course.id, 1000, 200, recent.id);
      enroll(recent.id, base.course.id, 10);
      enroll(older.id, base.course.id, 60, true);
      completeLessons(older.id, lessons);

      const last30 = getInstructorAnalytics(base.instructor.id, "30d", NOW);
      const all = getInstructorAnalytics(base.instructor.id, "all", NOW);

      expect(last30.studentCount).toBe(1);
      expect(last30.averageProgress).toBe(0);
      expect(last30.completionRate).toBe(0);
      expect(all.studentCount).toBe(2);
      expect(all.averageProgress).toBeCloseTo(0.5);
      expect(all.completionRate).toBeCloseTo(0.5);
    });

    it("reports no averages, rather than 0%, when nobody enrolled in range", () => {
      enroll(addUser().id, base.course.id, 60);

      const analytics = getInstructorAnalytics(base.instructor.id, "30d", NOW);

      expect(analytics.studentCount).toBe(0);
      expect(analytics.averageProgress).toBeNull();
      expect(analytics.completionRate).toBeNull();
    });
  });

  describe("getInstructorAnalytics — top buyers", () => {
    it("ranks buyers by total spent with purchases, seats and last purchase date", () => {
      const second = addCourse(base.instructor.id, "second-course");
      const big = addUser("Big Spender");
      const small = addUser("Small Spender");
      addPurchase(base.course.id, 4999, 20, big.id);
      addTeamPurchase(second.id, 9000, 3, 5, big.id);
      addPurchase(base.course.id, 2500, 2, small.id);

      const { topBuyers } = getInstructorAnalytics(
        base.instructor.id,
        "all",
        NOW
      );

      expect(topBuyers).toEqual([
        {
          userId: big.id,
          name: "Big Spender",
          email: "big-spender@example.com",
          totalSpent: 13999,
          purchaseCount: 2,
          seats: 4, // 1 for the solo purchase + 3 team seats
          lastPurchaseAt: daysBefore(5),
        },
        {
          userId: small.id,
          name: "Small Spender",
          email: "small-spender@example.com",
          totalSpent: 2500,
          purchaseCount: 1,
          seats: 1,
          lastPurchaseAt: daysBefore(2),
        },
      ]);
    });

    it("keeps only the top 10", () => {
      const buyers = Array.from({ length: 12 }, (_, i) => {
        const buyer = addUser(`Buyer ${i + 1}`);
        addPurchase(base.course.id, (i + 1) * 100, 1, buyer.id);
        return buyer;
      });

      const { topBuyers } = getInstructorAnalytics(
        base.instructor.id,
        "all",
        NOW
      );

      expect(topBuyers.map((b) => b.userId)).toEqual(
        buyers
          .slice(2)
          .reverse()
          .map((b) => b.id)
      );
    });

    it("only counts purchases within the range", () => {
      const buyer = addUser("Returning Buyer");
      addPurchase(base.course.id, 5000, 100, buyer.id);
      addPurchase(base.course.id, 1000, 10, buyer.id);
      const lapsed = addUser("Lapsed Buyer");
      addPurchase(base.course.id, 9000, 100, lapsed.id);

      const { topBuyers } = getInstructorAnalytics(
        base.instructor.id,
        "30d",
        NOW
      );

      expect(topBuyers).toHaveLength(1);
      expect(topBuyers[0]).toMatchObject({
        userId: buyer.id,
        totalSpent: 1000,
        purchaseCount: 1,
      });
    });
  });

  describe("getInstructorAnalytics — instructor scoping", () => {
    function twoInstructors() {
      const other = addUser("Other Instructor", schema.UserRole.Instructor);
      const otherCourse = addCourse(other.id, "other-instructor-course");
      const mine = addUser("My Buyer");
      const theirs = addUser("Their Buyer");
      addPurchase(base.course.id, 1000, 1, mine.id);
      addPurchase(otherCourse.id, 3000, 1, theirs.id);
      enroll(mine.id, base.course.id);
      enroll(theirs.id, otherCourse.id);
      return { mine, theirs };
    }

    it("never shows another instructor's buyers or students", () => {
      const { mine } = twoInstructors();

      const analytics = getInstructorAnalytics(base.instructor.id, "all", NOW);

      expect(analytics.buyerCount).toBe(1);
      expect(analytics.studentCount).toBe(1);
      expect(analytics.topBuyers.map((b) => b.userId)).toEqual([mine.id]);
    });

    it('spans every instructor\'s in-scope courses in "all" mode', () => {
      const { mine, theirs } = twoInstructors();
      const draft = addCourse(
        base.instructor.id,
        "draft-course",
        schema.CourseStatus.Draft
      );
      addPurchase(draft.id, 99999, 1, addUser().id);

      const analytics = getInstructorAnalytics("all", "all", NOW);

      expect(analytics.courseCount).toBe(2);
      expect(analytics.earnings.gross).toBe(4000);
      expect(analytics.buyerCount).toBe(2);
      expect(analytics.studentCount).toBe(2);
      expect(analytics.topBuyers.map((b) => b.userId)).toEqual([
        theirs.id,
        mine.id,
      ]);
    });
  });
  describe("getInstructorAnalytics — per-course rows", () => {
    it("lists one row per in-scope course with its own figures", () => {
      const second = addCourse(base.instructor.id, "second-course");
      addCourse(base.instructor.id, "draft-course", schema.CourseStatus.Draft);
      const lessons = addLessons(second.id, 2);
      addPurchase(base.course.id, 1000, 1, addUser().id);
      addPurchase(base.course.id, 2000, 1, addUser().id);
      const finisher = addUser();
      addPurchase(second.id, 500, 1, finisher.id);
      enroll(finisher.id, second.id, 1, true);
      completeLessons(finisher.id, lessons);

      const { courses } = getInstructorAnalytics(
        base.instructor.id,
        "all",
        NOW
      );

      expect(courses).toEqual([
        {
          courseId: base.course.id,
          title: "Test Course",
          salesCount: 2,
          earnings: { gross: 3000, platformFee: 600, net: 2400 },
          buyerCount: 2,
          studentCount: 0,
          averageProgress: null,
          completionRate: null,
        },
        {
          courseId: second.id,
          title: "second-course",
          salesCount: 1,
          earnings: { gross: 500, platformFee: 100, net: 400 },
          buyerCount: 1,
          studentCount: 1,
          averageProgress: 1,
          completionRate: 1,
        },
      ]);
    });

    it("respects the range in each row", () => {
      addPurchase(base.course.id, 1000, 10);
      addPurchase(base.course.id, 2000, 60);

      const [row] = getInstructorAnalytics(base.instructor.id, "30d", NOW)
        .courses;

      expect(row.salesCount).toBe(1);
      expect(row.earnings.gross).toBe(1000);
    });
  });

  describe("getCourseAnalytics — figures", () => {
    it("reports earnings, counts, progress and completion for that course only", () => {
      const other = addCourse(base.instructor.id, "other-course");
      const lessons = addLessons(base.course.id, 2);
      const [a, b] = [addUser(), addUser()];
      addPurchase(base.course.id, 4999, 1, a.id);
      addPurchase(other.id, 9999, 1, b.id);
      enroll(a.id, base.course.id, 1, true);
      completeLessons(a.id, lessons);
      enroll(b.id, base.course.id);
      enroll(b.id, other.id);

      const analytics = getCourseAnalytics(
        base.instructor.id,
        base.course.id,
        "all",
        NOW
      );

      expect(analytics).toMatchObject({
        course: { id: base.course.id, title: "Test Course" },
        salesCount: 1,
        earnings: { gross: 4999, platformFee: 1000, net: 3999 },
        buyerCount: 1,
        studentCount: 2,
        averageProgress: 0.5,
        completionRate: 0.5,
      });
    });

    it("respects the range", () => {
      addPurchase(base.course.id, 1000, 10);
      addPurchase(base.course.id, 2000, 60);
      enroll(addUser().id, base.course.id, 10);
      enroll(addUser().id, base.course.id, 60);

      const analytics = getCourseAnalytics(
        base.instructor.id,
        base.course.id,
        "30d",
        NOW
      )!;

      expect(analytics.salesCount).toBe(1);
      expect(analytics.earnings.gross).toBe(1000);
      expect(analytics.studentCount).toBe(1);
    });
  });

  describe("getCourseAnalytics — access scoping", () => {
    it("is unavailable for another instructor's course", () => {
      const other = addUser("Other Instructor", schema.UserRole.Instructor);
      const theirs = addCourse(other.id, "their-course");

      expect(
        getCourseAnalytics(base.instructor.id, theirs.id, "all", NOW)
      ).toBeNull();
    });

    it('is available for any instructor\'s course in "all" mode', () => {
      const other = addUser("Other Instructor", schema.UserRole.Instructor);
      const theirs = addCourse(other.id, "their-course");

      expect(getCourseAnalytics("all", theirs.id, "all", NOW)).toMatchObject({
        course: { id: theirs.id },
      });
    });

    it("is unavailable for drafts and missing courses", () => {
      const draft = addCourse(
        base.instructor.id,
        "draft-course",
        schema.CourseStatus.Draft
      );

      expect(getCourseAnalytics("all", draft.id, "all", NOW)).toBeNull();
      expect(getCourseAnalytics("all", 99999, "all", NOW)).toBeNull();
    });

    it("includes archived courses", () => {
      const archived = addCourse(
        base.instructor.id,
        "archived-course",
        schema.CourseStatus.Archived
      );

      expect(
        getCourseAnalytics(base.instructor.id, archived.id, "all", NOW)
      ).not.toBeNull();
    });
  });

  describe("getCourseAnalytics — drop-off", () => {
    /** Two modules, added out of order to prove ordering is by position. */
    function twoModuleCourse() {
      const [l3, l4] = addLessons(base.course.id, 2, "Second module", 2);
      const [l1, l2] = addLessons(base.course.id, 2, "First module", 1);
      return [l1, l2, l3, l4];
    }

    function dropOff(range: AnalyticsRange = "all") {
      return getCourseAnalytics(base.instructor.id, base.course.id, range, NOW)!
        .dropOff;
    }

    it("buckets students as never started, by furthest lesson, and finished, in course order", () => {
      const [l1, l2, l3] = twoModuleCourse();
      enroll(addUser().id, base.course.id); // never started
      const atL1 = addUser();
      enroll(atL1.id, base.course.id);
      completeLessons(atL1.id, [l1]);
      const atL3 = addUser();
      enroll(atL3.id, base.course.id);
      completeLessons(atL3.id, [l1, l2, l3]);
      const finisher = addUser();
      enroll(finisher.id, base.course.id, 1, true);

      expect(dropOff().buckets).toEqual([
        { kind: "never_started", label: "Never started", count: 1 },
        {
          kind: "lesson",
          lessonId: l1,
          label: "Lesson 1",
          moduleTitle: "First module",
          count: 1,
        },
        {
          kind: "lesson",
          lessonId: l2,
          label: "Lesson 2",
          moduleTitle: "First module",
          count: 0,
        },
        {
          kind: "lesson",
          lessonId: l3,
          label: "Lesson 1",
          moduleTitle: "Second module",
          count: 1,
        },
        {
          kind: "lesson",
          lessonId: expect.any(Number),
          label: "Lesson 2",
          moduleTitle: "Second module",
          count: 0,
        },
        { kind: "finished", label: "Finished", count: 1 },
      ]);
    });

    it("buckets skip-ahead students at their furthest completed lesson", () => {
      const [l1, , , l4] = twoModuleCourse();
      const skipper = addUser();
      enroll(skipper.id, base.course.id);
      completeLessons(skipper.id, [l1, l4]);

      const counts = dropOff().buckets.map((b) => b.count);

      expect(counts).toEqual([0, 0, 0, 0, 1, 0]);
    });

    it("ignores progress in other courses", () => {
      twoModuleCourse();
      const otherLessons = addLessons(
        addCourse(base.instructor.id, "other").id,
        1
      );
      const student = addUser();
      enroll(student.id, base.course.id);
      completeLessons(student.id, otherLessons);

      expect(dropOff().buckets[0].count).toBe(1);
    });

    it("highlights the lesson with the most stoppers, ignoring never started and finished", () => {
      const [l1, l2] = twoModuleCourse();
      for (let i = 0; i < 5; i++) enroll(addUser().id, base.course.id);
      for (let i = 0; i < 5; i++) enroll(addUser().id, base.course.id, 1, true);
      const stopper = addUser();
      enroll(stopper.id, base.course.id);
      completeLessons(stopper.id, [l1]);
      for (let i = 0; i < 2; i++) {
        const s = addUser();
        enroll(s.id, base.course.id);
        completeLessons(s.id, [l1, l2]);
      }

      expect(dropOff().mostStoppedLessonId).toBe(l2);
    });

    it("highlights no lesson when nobody stopped mid-course", () => {
      twoModuleCourse();
      enroll(addUser().id, base.course.id);
      enroll(addUser().id, base.course.id, 1, true);

      expect(dropOff().mostStoppedLessonId).toBeNull();
    });

    it("only buckets the cohort enrolled in range", () => {
      twoModuleCourse();
      enroll(addUser().id, base.course.id, 10);
      enroll(addUser().id, base.course.id, 60);

      expect(dropOff("30d").buckets[0].count).toBe(1);
      expect(dropOff("all").buckets[0].count).toBe(2);
    });
  });
});
