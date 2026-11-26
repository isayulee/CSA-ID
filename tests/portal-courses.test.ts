import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { adminAuditLog, advisingRequests, campuses, courses, peerAdviserAvailability, peerAdviserCourses, peerAdvisers, profiles, teachingKits, users } from "@/lib/db/schema";
import { createTestDb } from "./helpers";

type TestDb = Awaited<ReturnType<typeof createTestDb>>;
const state = vi.hoisted(() => ({ db: null as unknown, current: null as unknown, bindings: {} as Record<string, unknown> }));

vi.mock("@/lib/db", () => ({ getDb: () => state.db }));
vi.mock("@/lib/cloudflare", () => ({ getBindings: () => state.bindings }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentAccount: async () => state.current }));

const courseRoute = await import("@/app/api/portal/courses/route");
const campusRoute = await import("@/app/api/portal/campuses/route");
const me = await import("@/app/api/portal/me/route");
const myCampus = await import("@/app/api/portal/me/campus/route");
const myCourses = await import("@/app/api/portal/me/courses/route");
const myAvailability = await import("@/app/api/portal/me/availability/route");
const updateCourse = await import("@/app/api/admin/courses/update/route");
const mergeCourse = await import("@/app/api/admin/courses/merge/route");
const deleteCourse = await import("@/app/api/admin/courses/delete/route");
const addCampus = await import("@/app/api/admin/campuses/route");

let t: TestDb;
const ORIGIN = "http://localhost:3100";
const post = (path: string, body?: unknown) =>
  new Request(`${ORIGIN}${path}`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN }, body: JSON.stringify(body) });
const get = (path: string) => new Request(`${ORIGIN}${path}`);

async function seedUser(id: string, campusId?: string) {
  await t.db.insert(users).values({ id, googleSub: `sub-${id}`, email: `${id}@example.test`, name: id });
  await t.db.insert(profiles).values({ id: `p-${id}`, userId: id, displayName: id });
  if (campusId) await t.db.insert(peerAdvisers).values({ userId: id, campusId });
}
const signIn = async (id: string) => {
  const [user] = await t.db.select().from(users).where(eq(users.id, id));
  state.current = { user, profile: null };
};
const taught = async (id: string) => (await t.db.select().from(peerAdviserCourses).where(eq(peerAdviserCourses.userId, id))).map((r) => r.courseCode).sort();
const availability = async (id: string) => (await t.db.select().from(peerAdviserAvailability).where(eq(peerAdviserAvailability.userId, id))).map((r) => `${r.weekday}-${r.hour}`).sort();
const audit = (action: typeof adminAuditLog.$inferSelect.action) => t.db.select().from(adminAuditLog).where(eq(adminAuditLog.action, action));

beforeAll(async () => {
  t = await createTestDb();
  state.db = t.db;
  await seedUser("admin");
  await seedUser("ana", "intramuros");
  await seedUser("ben", "makati");
  await seedUser("una");
  await t.db.insert(courses).values([{ code: "MATH146", title: "Calculus 1" }, { code: "CS210", title: "Data Structures" }]);
});
afterAll(() => t.dispose());
beforeEach(() => {
  state.current = null;
  state.bindings = { ADMIN_GOOGLE_SUBS: "sub-admin" };
});

describe("Course list", () => {
  it("is closed to a User who isn't approved", async () => {
    await signIn("una");
    for (const response of [await courseRoute.GET(get("/api/portal/courses")), await campusRoute.GET(get("/api/portal/campuses")), await me.GET(get("/api/portal/me")),
      await courseRoute.POST(post("/api/portal/courses", { code: "PHYS141", title: "Physics" })), await myAvailability.POST(post("/api/portal/me/availability", { slots: [] }))]) {
      expect(response.status).toBe(403);
    }
    expect(await t.db.select().from(courses).where(eq(courses.code, "PHYS141"))).toEqual([]);
  });

  it("lets a Peer Adviser add a Course with a normalized code and rejects a duplicate", async () => {
    await signIn("ana");
    const response = await courseRoute.POST(post("/api/portal/courses", { code: " chm11-3 l ", title: "Chemistry Lab" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, course: { code: "CHM11-3L", title: "Chemistry Lab" } });
    expect((await courseRoute.POST(post("/api/portal/courses", { code: "math 146", title: "Again" }))).status).toBe(409);
    expect((await courseRoute.POST(post("/api/portal/courses", { code: "146MATH", title: "Bad" }))).status).toBe(400);
    expect((await courseRoute.POST(post("/api/portal/courses", { code: "MATH-", title: "Bad" }))).status).toBe(400);
    const [row] = await t.db.select().from(courses).where(eq(courses.code, "CHM11-3L"));
    expect(row.createdByUserId).toBe("ana");
    const list = await (await courseRoute.GET(get("/api/portal/courses"))).json() as { courses: { code: string }[] };
    expect(list.courses.map((c) => c.code)).toEqual(["CHM11-3L", "CS210", "MATH146"]);
    expect(await (await campusRoute.GET(get("/api/portal/campuses"))).json()).toEqual({ campuses: [{ id: "intramuros", name: "Intramuros" }, { id: "makati", name: "Makati" }] });
  });

  it("lets an Administrator who isn't a Peer Adviser add a Course too, unaudited like a Peer Adviser's", async () => {
    await signIn("admin");
    expect((await courseRoute.POST(post("/api/portal/courses", { code: "eng 101", title: "English" }))).status).toBe(200);
    const [row] = await t.db.select().from(courses).where(eq(courses.code, "ENG101"));
    expect(row.createdByUserId).toBe("admin");
    expect(await t.db.select().from(adminAuditLog)).toEqual([]);
  });
});

describe("a Peer Adviser's own Campus, courses taught and Availability", () => {
  it("saves and reads them back", async () => {
    await signIn("ana");
    expect((await myCampus.POST(post("/api/portal/me/campus", { campusId: "makati" }))).status).toBe(200);
    expect((await myCourses.POST(post("/api/portal/me/courses", { courseCodes: ["math 146", "CS210", "MATH146"] }))).status).toBe(200);
    expect((await myAvailability.POST(post("/api/portal/me/availability", { slots: [{ weekday: 1, hour: 8 }, { weekday: 6, hour: 16 }, { weekday: 1, hour: 8 }] }))).status).toBe(200);
    expect(await (await me.GET(get("/api/portal/me"))).json()).toEqual({ peerAdviser: { campusId: "makati", courseCodes: ["CS210", "MATH146"], availability: [{ weekday: 1, hour: 8 }, { weekday: 6, hour: 16 }] } });
  });

  it("rejects slots outside Monday to Saturday, 08:00 to 17:00, and unknown Courses or Campuses", async () => {
    await signIn("ana");
    for (const slot of [{ weekday: 7, hour: 9 }, { weekday: 0, hour: 9 }, { weekday: 1, hour: 17 }, { weekday: 1, hour: 7 }, { weekday: 1, hour: 8.5 }]) {
      expect((await myAvailability.POST(post("/api/portal/me/availability", { slots: [slot] }))).status).toBe(400);
    }
    expect((await myCourses.POST(post("/api/portal/me/courses", { courseCodes: ["NOPE101"] }))).status).toBe(400);
    expect((await myCampus.POST(post("/api/portal/me/campus", { campusId: "nowhere" }))).status).toBe(400);
    expect(await availability("ana")).toEqual(["1-8", "6-16"]);
  });

  it("saves the whole grid, which takes more than one insert statement", async () => {
    await signIn("ana");
    const slots = [1, 2, 3, 4, 5, 6].flatMap((weekday) => [8, 9, 10, 11, 12, 13, 14, 15, 16].map((hour) => ({ weekday, hour })));
    expect((await myAvailability.POST(post("/api/portal/me/availability", { slots }))).status).toBe(200);
    expect(await availability("ana")).toHaveLength(54);
    expect((await myAvailability.POST(post("/api/portal/me/availability", { slots: [{ weekday: 2, hour: 10 }] }))).status).toBe(200);
    expect(await availability("ana")).toEqual(["2-10"]);
  });

  it("never lets Peer Adviser A change B's courses or Availability", async () => {
    await t.db.insert(peerAdviserCourses).values({ userId: "ben", courseCode: "CS210" });
    await t.db.insert(peerAdviserAvailability).values({ userId: "ben", weekday: 3, hour: 14 });
    await signIn("ana");
    await myCourses.POST(post("/api/portal/me/courses", { userId: "ben", courseCodes: ["MATH146"] }));
    await myAvailability.POST(post("/api/portal/me/availability", { userId: "ben", slots: [{ weekday: 4, hour: 9 }] }));
    await myCampus.POST(post("/api/portal/me/campus", { userId: "ben", campusId: "intramuros" }));
    expect(await taught("ben")).toEqual(["CS210"]);
    expect(await availability("ben")).toEqual(["3-14"]);
    expect((await t.db.select().from(peerAdvisers).where(eq(peerAdvisers.userId, "ben")))[0].campusId).toBe("makati");
    expect(await taught("ana")).toEqual(["MATH146"]);
    expect(await availability("ana")).toEqual(["4-9"]);
  });

  it("tells an Administrator who isn't a Peer Adviser they have none", async () => {
    await signIn("admin");
    expect(await (await me.GET(get("/api/portal/me"))).json()).toEqual({ peerAdviser: null });
    expect((await myAvailability.POST(post("/api/portal/me/availability", { slots: [{ weekday: 1, hour: 9 }] }))).status).toBe(403);
    expect((await myCampus.POST(post("/api/portal/me/campus", { campusId: "makati" }))).status).toBe(403);
  });
});

describe("Administrator Course and Campus endpoints", () => {
  it("are closed to a Peer Adviser", async () => {
    await signIn("ana");
    expect((await updateCourse.POST(post("/api/admin/courses/update", { code: "CS210", newCode: "CS211", title: "x" }))).status).toBe(401);
    expect((await deleteCourse.POST(post("/api/admin/courses/delete", { code: "CS210", reason: "x" }))).status).toBe(401);
    expect((await mergeCourse.POST(post("/api/admin/courses/merge", { code: "CS210", into: "MATH146", reason: "x" }))).status).toBe(401);
    expect((await addCampus.POST(post("/api/admin/campuses", { id: "cavite", name: "Cavite" }))).status).toBe(401);
    expect(await t.db.select().from(adminAuditLog)).toEqual([]);
  });

  it("edit a Course's code everywhere it is used, audited", async () => {
    await t.db.insert(courses).values({ code: "PHYS141", title: "Physics" });
    await t.db.insert(peerAdviserCourses).values({ userId: "ben", courseCode: "PHYS141" });
    await signIn("admin");
    expect((await updateCourse.POST(post("/api/admin/courses/update", { code: "PHYS141", newCode: "phys 141-0", title: "Classical Mechanics" }))).status).toBe(200);
    expect(await taught("ben")).toEqual(["CS210", "PHYS141-0"]);
    expect(await t.db.select({ title: courses.title }).from(courses).where(eq(courses.code, "PHYS141-0"))).toEqual([{ title: "Classical Mechanics" }]);
    expect(await audit("update_course")).toEqual([expect.objectContaining({ targetType: "course", targetId: "PHYS141-0", targetLabel: "PHYS141 → PHYS141-0", actorGoogleSub: "sub-admin" })]);
    expect((await updateCourse.POST(post("/api/admin/courses/update", { code: "PHYS141-0", newCode: "CS210", title: "x" }))).status).toBe(409);
    expect((await updateCourse.POST(post("/api/admin/courses/update", { code: "GONE1", newCode: "GONE2", title: "x" }))).status).toBe(404);
    expect(await audit("update_course")).toHaveLength(1);
  });

  it("edit only a Course's title, audited", async () => {
    await signIn("admin");
    expect((await updateCourse.POST(post("/api/admin/courses/update", { code: "PHYS141-0", newCode: "PHYS141-0", title: "Physics 1" }))).status).toBe(200);
    expect(await t.db.select({ title: courses.title }).from(courses).where(eq(courses.code, "PHYS141-0"))).toEqual([{ title: "Physics 1" }]);
    expect(await audit("update_course")).toEqual([expect.anything(), expect.objectContaining({ targetId: "PHYS141-0", targetLabel: "PHYS141-0: Physics 1" })]);
  });

  it("merge a duplicate into another Course, re-pointing every reference, with a required reason", async () => {
    await t.db.insert(courses).values([{ code: "MATH146-0", title: "Calculus" }]);
    await t.db.insert(peerAdviserCourses).values([{ userId: "ana", courseCode: "MATH146-0" }, { userId: "ben", courseCode: "MATH146-0" }]);
    await t.db.insert(teachingKits).values({ id: "kit-dup", courseCode: "MATH146-0", academicYear: 2026, term: 1 });
    await t.db.insert(advisingRequests).values({ id: "req-dup", intakeKey: "d".repeat(64), submittedAt: 1, campusText: "Makati", courseText: "math146-0", courseCode: "MATH146-0" });
    await signIn("admin");
    expect((await mergeCourse.POST(post("/api/admin/courses/merge", { code: "MATH146-0", into: "MATH146" }))).status).toBe(400);
    const response = await mergeCourse.POST(post("/api/admin/courses/merge", { code: "MATH146-0", into: "MATH146", reason: "Duplicate" }));
    expect(response.status).toBe(200);
    expect(await t.db.select().from(courses).where(eq(courses.code, "MATH146-0"))).toEqual([]);
    expect(await taught("ana")).toEqual(["MATH146"]);
    expect(await taught("ben")).toEqual(["CS210", "MATH146", "PHYS141-0"]);
    expect((await t.db.select().from(teachingKits).where(eq(teachingKits.id, "kit-dup")))[0].courseCode).toBe("MATH146");
    expect((await t.db.select().from(advisingRequests).where(eq(advisingRequests.id, "req-dup")))[0].courseCode).toBe("MATH146");
    expect(await audit("merge_course")).toEqual([expect.objectContaining({ targetLabel: "MATH146-0 → MATH146", reason: "Duplicate" })]);
  });

  it("refuse to merge two Courses that both have a Teaching Kit for the same term", async () => {
    await t.db.insert(courses).values({ code: "CS210-0", title: "DS" });
    await t.db.insert(teachingKits).values([{ id: "kit-a", courseCode: "CS210-0", academicYear: 2026, term: 2 }, { id: "kit-b", courseCode: "CS210", academicYear: 2026, term: 2 }]);
    await signIn("admin");
    expect((await mergeCourse.POST(post("/api/admin/courses/merge", { code: "CS210-0", into: "CS210", reason: "Duplicate" }))).status).toBe(409);
    expect(await t.db.select().from(courses).where(eq(courses.code, "CS210-0"))).toHaveLength(1);
  });

  it("delete only a Course nothing uses, with a reason", async () => {
    await t.db.insert(courses).values({ code: "ART100", title: "Art" });
    await signIn("admin");
    expect((await deleteCourse.POST(post("/api/admin/courses/delete", { code: "ART100" }))).status).toBe(400);
    expect((await deleteCourse.POST(post("/api/admin/courses/delete", { code: "CS210", reason: "Unused" }))).status).toBe(409);
    expect(await t.db.select().from(courses).where(eq(courses.code, "CS210"))).toHaveLength(1);
    expect((await deleteCourse.POST(post("/api/admin/courses/delete", { code: "art100", reason: "Typo" }))).status).toBe(200);
    expect(await t.db.select().from(courses).where(eq(courses.code, "ART100"))).toEqual([]);
    expect(await audit("delete_course")).toEqual([expect.objectContaining({ targetId: "ART100", reason: "Typo" })]);
  });

  it("add a Campus, audited, and reject a duplicate", async () => {
    await signIn("admin");
    expect((await addCampus.POST(post("/api/admin/campuses", { id: "cavite", name: "Cavite" }))).status).toBe(200);
    expect(await t.db.select().from(campuses).where(eq(campuses.id, "cavite"))).toHaveLength(1);
    expect((await addCampus.POST(post("/api/admin/campuses", { id: "cavite-2", name: "Cavite" }))).status).toBe(409);
    expect((await addCampus.POST(post("/api/admin/campuses", { id: "Bad Id", name: "X" }))).status).toBe(400);
    expect(await audit("add_campus")).toEqual([expect.objectContaining({ targetId: "cavite", targetLabel: "Cavite" })]);
  });
});
