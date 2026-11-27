import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { Miniflare } from "miniflare";
import { adminAuditLog, courses, kitFiles, kitItems, kitVersions, peerAdvisers, teachingKits, users } from "@/lib/db/schema";
import { createTestDb } from "./helpers";

type TestDb = Awaited<ReturnType<typeof createTestDb>>;
const state = vi.hoisted(() => ({ db: null as unknown, current: null as unknown, bindings: {} as Record<string, unknown> }));

vi.mock("@/lib/db", () => ({ getDb: () => state.db }));
vi.mock("@/lib/cloudflare", () => ({ getBindings: () => state.bindings }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentAccount: async () => state.current }));

const kitsRoute = await import("@/app/api/portal/kits/route");
const kitRoute = await import("@/app/api/portal/kits/[id]/route");
const draftRoute = await import("@/app/api/portal/kit-drafts/route");
const filesRoute = await import("@/app/api/portal/kit-files/route");
const fileRoute = await import("@/app/api/portal/kit-files/[id]/route");
const reviewQueue = await import("@/app/api/admin/kit-drafts/route");
const approveRoute = await import("@/app/api/admin/kit-drafts/approve/route");
const rejectRoute = await import("@/app/api/admin/kit-drafts/reject/route");

let t: TestDb;
let mf: Miniflare;
let kv: KVNamespace;
const ORIGIN = "http://localhost:3100";
const post = (path: string, body?: unknown) =>
  new Request(`${ORIGIN}${path}`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN }, body: JSON.stringify(body) });
const get = (path: string) => new Request(`${ORIGIN}${path}`);
const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function seedUser(id: string, campusId?: string) {
  await t.db.insert(users).values({ id, googleSub: `sub-${id}`, email: `${id}@example.test`, name: id });
  if (campusId) await t.db.insert(peerAdvisers).values({ userId: id, campusId });
}
const signIn = async (id: string) => {
  const [user] = await t.db.select().from(users).where(eq(users.id, id));
  state.current = { user, profile: null };
};

type Item = { kind: "pdf"; label: string; fileId: string } | { kind: "drive" | "youtube"; label: string; url: string };
const draft = (overrides: Partial<{ courseCode: string; academicYear: number; term: number; title: string; body: string; items: Item[]; baseVersionId: string | null }> = {}) =>
  ({ courseCode: "MATH146", academicYear: 2026, term: 1, title: "Limits", body: "# Limits", items: [], ...overrides });
async function saveDraft(body: unknown) {
  const response = await draftRoute.POST(post("/api/portal/kit-drafts", body));
  return { status: response.status, json: await response.json() as { kitId: string; versionId: string; error?: string } };
}
async function readKit(id: string) {
  const response = await kitRoute.GET(get(`/api/portal/kits/${id}`), params(id));
  return { status: response.status, json: await response.json() as {
    kit: { id: string; courseCode: string }; current: { versionId: string; title: string; items: { label: string; fileId: string | null; url: string | null }[] } | null;
    myDraft: { versionId: string; status: string; title: string; reviewNote: string | null } | null;
  } };
}

const pdf = (size: number) => {
  const bytes = new Uint8Array(size).fill(0x20);
  bytes.set(new TextEncoder().encode("%PDF-1.7\n"));
  return bytes;
};
async function upload(bytes: Uint8Array, headers: Record<string, string> = {}) {
  const request = new Request(`${ORIGIN}/api/portal/kit-files`, {
    method: "POST", body: bytes as BodyInit,
    headers: { origin: ORIGIN, "content-type": "application/pdf", "content-length": String(bytes.byteLength), ...headers },
  });
  const response = await filesRoute.POST(request);
  return { status: response.status, json: await response.json() as { fileId: string; error?: string } };
}
const approve = (versionId: string) => approveRoute.POST(post("/api/admin/kit-drafts/approve", { versionId }));
const reject = (versionId: string, note?: string) => rejectRoute.POST(post("/api/admin/kit-drafts/reject", { versionId, note }));
const audit = (action: "approve_kit_draft" | "reject_kit_draft", versionIds: string[]) =>
  t.db.select().from(adminAuditLog).where(and(eq(adminAuditLog.action, action), inArray(adminAuditLog.targetId, versionIds)));

beforeAll(async () => {
  t = await createTestDb();
  state.db = t.db;
  mf = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('ok') } }", kvNamespaces: ["KV"] });
  kv = (await mf.getBindings<{ KV: KVNamespace }>()).KV;
  await seedUser("admin");
  await seedUser("ana", "intramuros");
  await seedUser("ben", "makati");
  await seedUser("una");
  await t.db.insert(courses).values([{ code: "MATH146", title: "Calculus 1" }, { code: "CS210", title: "Data Structures" }]);
});
afterAll(async () => { await t.dispose(); await mf.dispose(); });
beforeEach(async () => {
  state.current = null;
  state.bindings = { ADMIN_GOOGLE_SUBS: "sub-admin", KV: kv };
  await t.db.update(teachingKits).set({ currentVersionId: null });
  await t.db.delete(kitVersions);
  await t.db.delete(teachingKits);
  await t.db.delete(kitFiles);
  for (const { name } of (await kv.list({ prefix: "kit/" })).keys) await kv.delete(name);
});

describe("access", () => {
  it("closes every Teaching Kit route to a User who isn't approved", async () => {
    await signIn("ana");
    const { json } = await saveDraft(draft());
    await signIn("admin");
    expect((await approve(json.versionId)).status).toBe(200);
    const [file] = await t.db.insert(kitFiles).values({ id: "f1", kvKey: "kit/f1.pdf", sizeBytes: 10 }).returning();
    await kv.put(file.kvKey, pdf(10));

    await signIn("una");
    for (const response of [
      await kitsRoute.GET(get("/api/portal/kits")),
      await kitRoute.GET(get(`/api/portal/kits/${json.kitId}`), params(json.kitId)),
      await draftRoute.POST(post("/api/portal/kit-drafts", draft({ title: "Mine" }))),
      await fileRoute.GET(get("/api/portal/kit-files/f1"), params("f1")),
      await reviewQueue.GET(get("/api/admin/kit-drafts")),
    ]) expect(response.status).toBe(403);
    expect((await upload(pdf(100))).status).toBe(403);
    // Administrator actions answer a non-Administrator like a signed-out visitor.
    expect((await approve(json.versionId)).status).toBe(401);
    expect((await reject(json.versionId, "No")).status).toBe(401);
    expect(await t.db.select().from(kitFiles)).toHaveLength(1);
    expect(await t.db.select().from(kitVersions)).toHaveLength(1);

    state.current = null;
    expect((await kitsRoute.GET(get("/api/portal/kits"))).status).toBe(401);
    expect((await fileRoute.GET(get("/api/portal/kit-files/f1"), params("f1"))).status).toBe(401);
  });

  it("keeps a Peer Adviser out of the review queue", async () => {
    await signIn("ana");
    expect((await reviewQueue.GET(get("/api/admin/kit-drafts"))).status).toBe(403);
  });
});

describe("Kit Drafts", () => {
  it("saves a new kit as a pending Kit Draft that only its author and Administrators can see", async () => {
    await signIn("ana");
    const { status, json } = await saveDraft(draft({ courseCode: "math 146", items: [{ kind: "youtube", label: "Lecture", url: "https://www.youtube.com/watch?v=abc" }] }));
    expect(status).toBe(200);
    const [version] = await t.db.select().from(kitVersions).where(eq(kitVersions.id, json.versionId));
    expect(version).toMatchObject({ kitId: json.kitId, status: "pending", baseVersionId: null, authorUserId: "ana", title: "Limits" });
    const read = await readKit(json.kitId);
    expect(read.status).toBe(200);
    expect(read.json.current).toBeNull();
    expect(read.json.myDraft).toMatchObject({ versionId: json.versionId, status: "pending", title: "Limits" });

    await signIn("ben");
    expect((await readKit(json.kitId)).status).toBe(404);
    expect(await (await kitsRoute.GET(get("/api/portal/kits"))).json()).toEqual({ kits: [], myDrafts: [] });

    await signIn("admin");
    expect((await readKit(json.kitId)).status).toBe(200);
  });

  it("lets the author edit their pending draft in place, and a second author proposing the same kit shares its kit row", async () => {
    await signIn("ana");
    const first = await saveDraft(draft());
    const edited = await saveDraft(draft({ title: "Limits, revised", items: [{ kind: "drive", label: "Notes", url: "https://drive.google.com/file/d/x" }] }));
    expect(edited.json).toEqual({ ok: true, kitId: first.json.kitId, versionId: first.json.versionId });
    const [version] = await t.db.select().from(kitVersions).where(eq(kitVersions.id, first.json.versionId));
    expect(version.title).toBe("Limits, revised");
    expect(await t.db.select({ label: kitItems.label }).from(kitItems)).toEqual([{ label: "Notes" }]);

    await signIn("ben");
    const other = await saveDraft(draft({ title: "Ben's limits" }));
    expect(other.json.kitId).toBe(first.json.kitId);
    expect(other.json.versionId).not.toBe(first.json.versionId);
    expect(await t.db.select().from(teachingKits)).toHaveLength(1);
    // Ben's save never touched Ana's draft.
    const [anas] = await t.db.select().from(kitVersions).where(eq(kitVersions.id, first.json.versionId));
    expect(anas).toMatchObject({ title: "Limits, revised", authorUserId: "ana", status: "pending" });
  });

  it("accepts Drive and YouTube links only from the allowed hosts", async () => {
    await signIn("ana");
    for (const url of ["https://docs.google.com/document/d/x", "https://youtu.be/abc", "https://drive.google.com/drive/folders/x"]) {
      expect((await saveDraft(draft({ items: [{ kind: "drive", label: "Link", url }] }))).status).toBe(200);
    }
    for (const url of ["http://drive.google.com/x", "https://evil.example/x", "https://drive.google.com.evil.example/x", "https://user@drive.google.com/x", "https://youtube.com/x", "javascript:alert(1)", `https://youtu.be/${"a".repeat(500)}`]) {
      expect((await saveDraft(draft({ items: [{ kind: "youtube", label: "Link", url }] }))).status).toBe(400);
    }
  });

  it("rejects an unknown Course, a PDF item for a file that doesn't exist, and more than 50 items", async () => {
    await signIn("ana");
    expect((await saveDraft(draft({ courseCode: "NOPE101" }))).status).toBe(400);
    expect((await saveDraft(draft({ items: [{ kind: "pdf", label: "Ghost", fileId: "missing" }] }))).status).toBe(400);
    const many = Array.from({ length: 51 }, (_, i) => ({ kind: "drive" as const, label: `L${i}`, url: "https://drive.google.com/x" }));
    expect((await saveDraft(draft({ items: many }))).status).toBe(400);
    expect(await t.db.select().from(kitVersions)).toEqual([]);
  });
});

describe("approval", () => {
  it("approves a draft in one audited batch, shows it to every Peer Adviser, and drops the older version's items", async () => {
    await signIn("ana");
    const first = await saveDraft(draft({ items: [{ kind: "drive", label: "Old notes", url: "https://drive.google.com/old" }] }));
    await signIn("admin");
    expect((await approve(first.json.versionId)).status).toBe(200);

    await signIn("ben");
    const read = await readKit(first.json.kitId);
    expect(read.json.current).toMatchObject({ versionId: first.json.versionId, title: "Limits", items: [{ label: "Old notes" }] });
    const list = await (await kitsRoute.GET(get("/api/portal/kits?course=MATH146"))).json() as { kits: { id: string }[] };
    expect(list.kits.map((k) => k.id)).toEqual([first.json.kitId]);

    const second = await saveDraft(draft({ title: "Limits v2", items: [{ kind: "drive", label: "New notes", url: "https://drive.google.com/new" }] }));
    const [base] = await t.db.select().from(kitVersions).where(eq(kitVersions.id, second.json.versionId));
    expect(base.baseVersionId).toBe(first.json.versionId);
    await signIn("admin");
    expect((await approve(second.json.versionId)).status).toBe(200);
    expect((await approve(second.json.versionId)).status).toBe(409);

    const [kit] = await t.db.select().from(teachingKits).where(eq(teachingKits.id, first.json.kitId));
    expect(kit.currentVersionId).toBe(second.json.versionId);
    expect(await t.db.select({ label: kitItems.label }).from(kitItems)).toEqual([{ label: "New notes" }]);
    const [older] = await t.db.select().from(kitVersions).where(eq(kitVersions.id, first.json.versionId));
    expect(older).toMatchObject({ status: "approved", title: "Limits" });
    const entries = await audit("approve_kit_draft", [first.json.versionId, second.json.versionId]);
    expect(entries.map((e) => e.targetId).sort()).toEqual([first.json.versionId, second.json.versionId].sort());
    expect(entries[0]).toMatchObject({ actorGoogleSub: "sub-admin", targetType: "kit_version" });
  });

  it("flags a draft written against a version that is no longer current", async () => {
    await signIn("ana");
    const a = await saveDraft(draft());
    await signIn("ben");
    const b = await saveDraft(draft({ title: "Ben's" }));
    await signIn("admin");
    let queue = await (await reviewQueue.GET(get("/api/admin/kit-drafts"))).json() as { drafts: { versionId: string; stale: boolean }[] };
    expect(queue.drafts.map((d) => d.stale)).toEqual([false, false]);
    await approve(a.json.versionId);
    queue = await (await reviewQueue.GET(get("/api/admin/kit-drafts"))).json() as typeof queue;
    expect(queue.drafts).toMatchObject([{ versionId: b.json.versionId, stale: true }]);

    // Ana opens the approved version to edit it, and Ben's draft is approved before she saves.
    await approve(b.json.versionId);
    await signIn("ana");
    expect((await saveDraft(draft({ courseCode: "CS210", baseVersionId: a.json.versionId }))).status).toBe(400);
    const c = await saveDraft(draft({ title: "Ana's edit", baseVersionId: a.json.versionId }));
    await signIn("admin");
    queue = await (await reviewQueue.GET(get("/api/admin/kit-drafts"))).json() as typeof queue;
    expect(queue.drafts).toMatchObject([{ versionId: c.json.versionId, stale: true }]);
  });
});

describe("rejection", () => {
  it("needs a note, keeps the draft for its author to read, deletes its items and audits the note", async () => {
    await signIn("ana");
    const { json } = await saveDraft(draft({ items: [{ kind: "drive", label: "Notes", url: "https://drive.google.com/x" }] }));
    await signIn("admin");
    expect((await reject(json.versionId)).status).toBe(400);
    expect((await reject(json.versionId, "   ")).status).toBe(400);
    expect((await reject(json.versionId, "Add worked examples")).status).toBe(200);
    expect((await reject(json.versionId, "Again")).status).toBe(409);
    expect((await approve(json.versionId)).status).toBe(409);

    expect(await t.db.select().from(kitItems)).toEqual([]);
    expect(await audit("reject_kit_draft", [json.versionId])).toMatchObject([{ targetId: json.versionId, reason: "Add worked examples" }]);
    await signIn("ana");
    expect((await readKit(json.kitId)).json.myDraft).toMatchObject({ status: "rejected", reviewNote: "Add worked examples" });
    // A reviewed draft can't be edited; saving again starts a new one.
    const next = await saveDraft(draft({ title: "Limits with examples" }));
    expect(next.json.versionId).not.toBe(json.versionId);
  });
});

describe("PDF files", () => {
  it("stores a PDF under its file id and serves it only to Peer Advisers with private headers", async () => {
    await signIn("ana");
    const { status, json } = await upload(pdf(1000));
    expect(status).toBe(200);
    const [row] = await t.db.select().from(kitFiles).where(eq(kitFiles.id, json.fileId));
    expect(row).toMatchObject({ kvKey: `kit/${json.fileId}.pdf`, sizeBytes: 1000, uploadedByUserId: "ana" });
    expect((await kv.get(row.kvKey, "arrayBuffer"))?.byteLength).toBe(1000);

    await signIn("ben");
    const response = await fileRoute.GET(get(`/api/portal/kit-files/${json.fileId}`), params(json.fileId));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toBe("sandbox");
    expect(response.headers.get("cache-control")).toMatch(/^private/);
    expect((await response.arrayBuffer()).byteLength).toBe(1000);
    expect((await fileRoute.GET(get("/api/portal/kit-files/nope"), params("nope"))).status).toBe(404);
  });

  it("lets a Peer Adviser attach only PDFs they uploaded or that an approved version already holds", async () => {
    await signIn("ana");
    const anas = (await upload(pdf(100))).json.fileId;
    const approvedFile = (await upload(pdf(100))).json.fileId;
    const first = await saveDraft(draft({ items: [{ kind: "pdf", label: "Shared", fileId: approvedFile }] }));
    await signIn("admin");
    await approve(first.json.versionId);

    await signIn("ben");
    expect((await saveDraft(draft({ items: [{ kind: "pdf", label: "Taken", fileId: anas }] }))).status).toBe(400);
    expect((await saveDraft(draft({ items: [{ kind: "pdf", label: "Shared", fileId: approvedFile }] }))).status).toBe(200);
  });

  it("accepts only %PDF- files up to 5 MiB", async () => {
    await signIn("ana");
    expect((await upload(new TextEncoder().encode("<html>not a pdf</html>"))).status).toBe(415);
    expect((await upload(new Uint8Array(0))).status).toBe(400);
    expect((await upload(pdf(5 * 1024 * 1024 + 1))).status).toBe(413);
    // A declared length that lies is caught while streaming.
    expect((await upload(pdf(5 * 1024 * 1024 + 1), { "content-length": "100" })).status).toBe(413);
    expect((await upload(pdf(5 * 1024 * 1024))).status).toBe(200);
    expect(await t.db.select().from(kitFiles)).toHaveLength(1);
  });

  it("stops at 500 MB in total", async () => {
    const full = Array.from({ length: 95 }, (_, i) => ({ id: `seed${i}`, kvKey: `kit/seed${i}.pdf`, sizeBytes: 5 * 1024 * 1024 }));
    for (let i = 0; i < full.length; i += 20) await t.db.insert(kitFiles).values(full.slice(i, i + 20));
    await signIn("ana");
    const over = await upload(pdf(2_000_000));
    expect(over.status).toBe(507);
    expect(over.json.error).toMatch(/storage is full/i);
    expect((await upload(pdf(1000))).status).toBe(200);
    expect(await t.db.select().from(kitFiles)).toHaveLength(96);
  });

  it("deletes a PDF once no draft or approved version uses it", async () => {
    await signIn("ana");
    const kept = (await upload(pdf(100))).json.fileId;
    const dropped = (await upload(pdf(200))).json.fileId;
    const { json } = await saveDraft(draft({ items: [{ kind: "pdf", label: "A", fileId: kept }, { kind: "pdf", label: "B", fileId: dropped }] }));
    // Editing the draft drops B.
    await saveDraft(draft({ items: [{ kind: "pdf", label: "A", fileId: kept }] }));
    expect((await t.db.select().from(kitFiles)).map((f) => f.id)).toEqual([kept]);
    expect(await kv.get(`kit/${dropped}.pdf`)).toBeNull();

    // Rejecting the draft drops A too.
    await signIn("admin");
    await reject(json.versionId, "Not yet");
    expect(await t.db.select().from(kitFiles)).toEqual([]);
    expect(await kv.get(`kit/${kept}.pdf`)).toBeNull();
  });

  it("keeps a PDF the approved version shares with a newer draft, and sweeps uploads left unattached for a day", async () => {
    await signIn("ana");
    const shared = (await upload(pdf(100))).json.fileId;
    const first = await saveDraft(draft({ items: [{ kind: "pdf", label: "Shared", fileId: shared }] }));
    await signIn("admin");
    await approve(first.json.versionId);
    await signIn("ben");
    const second = await saveDraft(draft({ title: "v2", items: [{ kind: "pdf", label: "Shared", fileId: shared }] }));
    await signIn("admin");
    await approve(second.json.versionId);
    expect((await t.db.select().from(kitFiles)).map((f) => f.id)).toEqual([shared]);

    await signIn("ana");
    const stale = (await upload(pdf(100))).json.fileId;
    const fresh = (await upload(pdf(100))).json.fileId;
    await t.db.update(kitFiles).set({ createdAt: Math.floor(Date.now() / 1000) - 25 * 3600 }).where(eq(kitFiles.id, stale));
    const latest = (await upload(pdf(100))).json.fileId;
    expect((await t.db.select({ id: kitFiles.id }).from(kitFiles)).map((f) => f.id).sort()).toEqual([shared, fresh, latest].sort());
    expect(await kv.get(`kit/${stale}.pdf`)).toBeNull();
  });
});
