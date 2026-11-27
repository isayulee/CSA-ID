import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { adviseeContacts, advisingRequests, advisingRequestSlots, courses } from "@/lib/db/schema";
import { createTestDb } from "./helpers";

type TestDb = Awaited<ReturnType<typeof createTestDb>>;
const state = vi.hoisted(() => ({ db: null as unknown, bindings: {} as Record<string, unknown> }));

vi.mock("@/lib/db", () => ({ getDb: () => state.db }));
vi.mock("@/lib/cloudflare", () => ({ getBindings: () => state.bindings }));

const route = await import("@/app/api/intake/advising-requests/route");

let t: TestDb;
const SECRET = "test-intake-secret-0123456789abcdef";
const URL_ = "http://localhost:3100/api/intake/advising-requests";

// Fake answers, shaped like the intake Sheet's columns as the Apps Script sends them.
const row = (overrides: Record<string, unknown> = {}) => ({
  timestamp: "2026-08-24T01:15:00.000Z",
  email: "advisee@example.test",
  fullName: "Juan Dela Cruz",
  studentNumber: 2024123456,
  programYear: "BS CS 2",
  cardinalMail: "jdcruz@mymail.example.test",
  campus: "intramuros",
  course: "Calculus 1/MATH146",
  topic: "Limits and derivatives",
  attendees: "2",
  availableDays: "MWF",
  availableTimes: "1-3pm",
  signature: "data:image/png;base64,AAAA",
  ...overrides,
});

async function requestFor(email: string) {
  const [contact] = await t.db.select().from(adviseeContacts).where(eq(adviseeContacts.email, email));
  if (!contact) return null;
  const [request] = await t.db.select().from(advisingRequests).where(eq(advisingRequests.id, contact.requestId));
  const slots = await t.db.select().from(advisingRequestSlots).where(eq(advisingRequestSlots.requestId, contact.requestId));
  return { request, contact, slots: slots.map((s) => `${s.weekday}${s.onDate ? `@${s.onDate}` : ""}-${s.hour}`).sort() };
}

function push(body: unknown, { secret = SECRET as string | null, raw }: { secret?: string | null; raw?: string } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (secret !== null) headers.authorization = `Bearer ${secret}`;
  return route.POST(new Request(URL_, { method: "POST", headers, body: raw ?? JSON.stringify(body) }));
}

beforeAll(async () => {
  t = await createTestDb();
  state.db = t.db;
  await t.db.insert(courses).values({ code: "MATH146", title: "Calculus 1" });
});
afterAll(() => t.dispose());
beforeEach(() => {
  state.bindings = { INTAKE_SECRET: SECRET };
});

describe("POST /api/intake/advising-requests", () => {
  it("returns 401 without the INTAKE_SECRET bearer", async () => {
    expect((await push([], { secret: null })).status).toBe(401);
    expect((await push([], { secret: "wrong" })).status).toBe(401);
    state.bindings = {};
    expect((await push([], { secret: "" })).status).toBe(401);
  });

  it("imports a row with its contact, Course, Campus and slots, and never stores the Signature", async () => {
    const response = await push([row()]);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: 1, imported: 1, duplicates: 0, rejected: [], failed: [] });
    const saved = await requestFor("advisee@example.test");
    expect(saved?.request).toMatchObject({
      submittedAt: Date.parse("2026-08-24T01:15:00.000Z") / 1000,
      campusText: "intramuros",
      campusId: "intramuros",
      courseText: "Calculus 1/MATH146",
      courseCode: "MATH146",
      topic: "Limits and derivatives",
      attendeeCount: 2,
      availableDayText: "MWF",
      availableTimeText: "1-3pm",
      timesUnclear: false,
      status: "pending",
      claimedByUserId: null,
      sheetPeerAdviser: null,
      sheetRemarks: null,
      scheduledOn: null,
    });
    expect(saved?.request.intakeKey).toMatch(/^[0-9a-f]{64}$/);
    expect(saved?.contact).toMatchObject({ fullName: "Juan Dela Cruz", studentNumber: "2024123456", programYear: "BS CS 2", cardinalMail: "jdcruz@mymail.example.test" });
    expect(saved?.slots).toEqual(["1-13", "1-14", "3-13", "3-14", "5-13", "5-14"]);
    const stored = JSON.stringify(await t.d1.prepare("select * from advising_requests, advisee_contacts").all());
    expect(stored).not.toContain("data:image");
  });

  it("writes nothing and fails nothing when the same rows arrive again", async () => {
    const first = row({ email: "again@example.test", timestamp: "2026-08-25T02:00:00.000Z" });
    expect(await (await push([first])).json()).toMatchObject({ imported: 1, duplicates: 0 });
    const before = await t.d1.prepare("select (select count(*) from advising_requests) r, (select count(*) from advisee_contacts) c, (select count(*) from advising_request_slots) s").first();
    // The Sheet's hand-edited columns changing later does not touch the imported request.
    const response = await push([{ ...first, email: " AGAIN@example.test ", remarks: "Done" }, first]);
    expect(await response.json()).toMatchObject({ received: 2, imported: 0, duplicates: 2, rejected: [], failed: [] });
    const after = await t.d1.prepare("select (select count(*) from advising_requests) r, (select count(*) from advisee_contacts) c, (select count(*) from advising_request_slots) s").first();
    expect(after).toEqual(before);
    expect((await requestFor("again@example.test"))?.request.status).toBe("pending");
  });

  it("maps a launch-import row's Remarks to a status and keeps the Sheet's text", async () => {
    await push([row({
      email: "past@example.test",
      peerAdviser: "Ana Santos",
      scheduledDate: "27-Aug-25",
      remarks: "Rescheduled to Friday, then done",
    })]);
    const saved = await requestFor("past@example.test");
    expect(saved?.request).toMatchObject({
      status: "rescheduled",
      sheetRemarks: "Rescheduled to Friday, then done",
      sheetPeerAdviser: "Ana Santos",
      scheduledOn: "2025-08-27",
      claimedByUserId: null,
    });
  });

  it("reports a row it can't key, cuts long text, and leaves an unknown Campus, Course or time for a person", async () => {
    const response = await push([
      row({ email: "", timestamp: "2026-08-26T00:00:00.000Z" }),
      row({ timestamp: "not a date" }),
      row({
        email: "long@example.test",
        topic: "x".repeat(2500),
        campus: "Online",
        course: "Calculus 1",
        attendees: "about 80 of us",
        availableDays: "whenever",
        availableTimes: "",
      }),
    ]);
    expect(await response.json()).toEqual({
      received: 3, imported: 1, duplicates: 0, failed: [],
      rejected: [{ row: 0, error: "email is empty" }, { row: 1, error: "timestamp is not a date" }],
    });
    const saved = await requestFor("long@example.test");
    expect(saved?.request.topic).toHaveLength(2000);
    expect(saved?.request).toMatchObject({ campusText: "Online", campusId: null, courseCode: null, attendeeCount: 50, timesUnclear: true });
    expect(saved?.slots).toEqual([]);
  });

  it("refuses more than 100 rows, a body that isn't an array, and a body over 256 KiB", async () => {
    expect((await push(Array.from({ length: 101 }, () => ({})))).status).toBe(400);
    expect((await push({ rows: [] })).status).toBe(400);
    expect((await push(null, { raw: "{" })).status).toBe(400);
    const tooLarge = await push(null, { raw: JSON.stringify([{ topic: "x".repeat(256 * 1024) }]) });
    expect(tooLarge.status).toBe(413);
  });

  it("writes a push of more than 25 rows, and a row D1 refuses holds back none of the others", async () => {
    const rows = Array.from({ length: 30 }, (_, i) => row({ email: `bulk${i}@example.test`, timestamp: "2026-09-01T00:00:00.000Z" }));
    // Stands in for a row the database refuses, such as a Course deleted while the push runs.
    const batch = t.db.batch.bind(t.db);
    const spy = vi.spyOn(t.db, "batch").mockImplementation(((statements: { toSQL: () => { params: unknown[] } }[]) => {
      if (statements.some((statement) => statement.toSQL().params.includes("bulk7@example.test"))) {
        return Promise.reject(new Error("FOREIGN KEY constraint failed"));
      }
      return batch(statements as never);
    }) as typeof t.db.batch);
    try {
      const outcome = await (await push(rows)).json();
      expect(outcome).toEqual({ received: 30, imported: 29, duplicates: 0, rejected: [], failed: [7] });
    } finally {
      spy.mockRestore();
    }
    expect(await requestFor("bulk29@example.test")).not.toBeNull();
    expect(await requestFor("bulk7@example.test")).toBeNull();
    expect(await (await push(rows)).json()).toMatchObject({ imported: 1, duplicates: 29, failed: [] });
  }, 30_000);
});
