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
  getInstructorAnalytics,
  type AnalyticsRange,
} from "./analyticsService";

const NOW = new Date("2026-06-30T12:00:00.000Z");

function daysBefore(days: number) {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

function addPurchase(courseId: number, amountPaid: number, daysAgo = 1) {
  testDb
    .insert(schema.purchases)
    .values({
      userId: base.user.id,
      courseId,
      amountPaid,
      country: "US",
      createdAt: daysBefore(daysAgo),
    })
    .run();
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
});
