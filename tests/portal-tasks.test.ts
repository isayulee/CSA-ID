import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { boardColumns, boards, peerAdvisers, projectMembers, projects, taskAssignees, tasks, users } from "@/lib/db/schema";
import { createTestDb } from "./helpers";

type TestDb = Awaited<ReturnType<typeof createTestDb>>;
const state = vi.hoisted(() => ({ db: null as unknown, current: null as unknown, bindings: {} as Record<string, unknown> }));

vi.mock("@/lib/db", () => ({ getDb: () => state.db }));
vi.mock("@/lib/cloudflare", () => ({ getBindings: () => state.bindings }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentAccount: async () => state.current }));

const projectList = await import("@/app/api/portal/tasks/projects/route");
const projectRoute = await import("@/app/api/portal/tasks/projects/[projectId]/route");
const boardRoute = await import("@/app/api/portal/tasks/boards/[boardId]/route");

let t: TestDb;
const ORIGIN = "http://localhost:3100";
const getProjects = () => projectList.GET(new Request(`${ORIGIN}/api/portal/tasks/projects`));
const getProject = (projectId: string) =>
  projectRoute.GET(new Request(`${ORIGIN}/api/portal/tasks/projects/${projectId}`), { params: Promise.resolve({ projectId }) });
const getBoard = (boardId: string) =>
  boardRoute.GET(new Request(`${ORIGIN}/api/portal/tasks/boards/${boardId}`), { params: Promise.resolve({ boardId }) });

async function seedUser(id: string, name = id) {
  await t.db.insert(users).values({ id, googleSub: `sub-${id}`, email: `${id}@example.test`, name });
}
async function seedPeerAdviser(id: string, roles: { studentAssistant?: boolean; officer?: string } = {}) {
  await seedUser(id, `${id} name`);
  await t.db.insert(peerAdvisers).values({
    userId: id,
    campusId: "intramuros",
    studentAssistant: roles.studentAssistant ?? false,
    officerPosition: roles.officer ?? null,
    officerOrder: roles.officer ? 1 : null,
  });
}
const signIn = async (id: string) => {
  const [user] = await t.db.select().from(users).where(eq(users.id, id));
  state.current = { user, profile: null };
};
const projectIdsFor = async (id: string) => {
  await signIn(id);
  const response = await getProjects();
  expect(response.status).toBe(200);
  const body = await response.json() as { projects: { id: string }[] };
  return body.projects.map((project) => project.id);
};

const DEFAULTS = ["project-peer-advisers", "project-student-assistants", "project-officers"];

beforeAll(async () => {
  t = await createTestDb();
  state.db = t.db;
  await seedUser("admin", "Admin");
  await seedUser("una", "Una Outsider");
  await seedPeerAdviser("amy");
  await seedPeerAdviser("sam", { studentAssistant: true });
  await seedPeerAdviser("ollie", { officer: "President" });
  await seedPeerAdviser("cara");

  // A custom Project with Cara as its only member, and an archived one she also belongs to.
  await t.db.insert(projects).values([
    { id: "project-custom", name: "Orientation Week" },
    { id: "project-archived", name: "Old Drive", archivedAt: 1 },
  ]);
  await t.db.insert(projectMembers).values([
    { projectId: "project-custom", userId: "cara" },
    { projectId: "project-archived", userId: "cara" },
  ]);
  await t.db.insert(boards).values({ id: "board-custom", projectId: "project-custom", name: "Plan", position: 1024 });
  await t.db.insert(boardColumns).values({ id: "column-custom-done", boardId: "board-custom", name: "Done", position: 1024, isDone: true });

  // Tasks on the Student Assistants Board, inserted out of order to prove the read sorts them.
  await t.db.insert(tasks).values([
    { id: "task-late", boardId: "board-student-assistants", columnId: "column-student-assistants-ready", position: 2048, title: "Second" },
    { id: "task-early", boardId: "board-student-assistants", columnId: "column-student-assistants-ready", position: 1024, title: "First", dueOn: "2026-12-01" },
    { id: "task-done", boardId: "board-student-assistants", columnId: "column-student-assistants-done", position: 1024, title: "Finished" },
  ]);
  await t.db.insert(taskAssignees).values([{ taskId: "task-early", userId: "sam" }, { taskId: "task-early", userId: "amy" }]);
});
afterAll(() => t.dispose());
beforeEach(() => {
  state.current = null;
  state.bindings = { ADMIN_GOOGLE_SUBS: "sub-admin" };
});

describe("the default Projects seeded by the migration", () => {
  it("are the three default Projects, each with one kanban Board holding Ready, In Progress and Done", async () => {
    const rows = await t.db.select().from(projects).where(eq(projects.id, "project-peer-advisers"));
    expect(rows[0]).toMatchObject({ defaultKey: "peer_advisers", name: "Peer Advisers", archivedAt: null });
    for (const projectId of DEFAULTS) {
      const projectBoards = await t.db.select().from(boards).where(eq(boards.projectId, projectId));
      expect(projectBoards).toHaveLength(1);
      expect(projectBoards[0].boardType).toBe("kanban");
      const columns = await t.db.select({ name: boardColumns.name, isDone: boardColumns.isDone })
        .from(boardColumns).where(eq(boardColumns.boardId, projectBoards[0].id)).orderBy(boardColumns.position);
      expect(columns).toEqual([
        { name: "Ready", isDone: false },
        { name: "In Progress", isDone: false },
        { name: "Done", isDone: true },
      ]);
    }
  });

  it("can't be archived, and a Board can't have a second done Column", async () => {
    await expect(t.db.update(projects).set({ archivedAt: 1 }).where(eq(projects.id, "project-officers"))).rejects.toThrow();
    await expect(t.db.update(boardColumns).set({ isDone: true }).where(eq(boardColumns.id, "column-officers-ready"))).rejects.toThrow();
  });

  it("keeps a Task's Column on the Task's own Board", async () => {
    await expect(t.db.insert(tasks).values({
      id: "task-stray", boardId: "board-officers", columnId: "column-peer-advisers-ready", position: 1024, title: "Wrong Board",
    })).rejects.toThrow();
  });
});

describe("GET /api/portal/tasks/projects", () => {
  it("derives default membership from roles, and Administrators see every Project", async () => {
    expect(await projectIdsFor("amy")).toEqual(["project-peer-advisers"]);
    expect(await projectIdsFor("sam")).toEqual(["project-peer-advisers", "project-student-assistants"]);
    expect(await projectIdsFor("ollie")).toEqual(["project-peer-advisers", "project-officers"]);
    expect(await projectIdsFor("admin")).toEqual([...DEFAULTS, "project-custom"]);
  });

  it("lists a custom Project only to its members, and leaves archived Projects out", async () => {
    expect(await projectIdsFor("cara")).toEqual(["project-peer-advisers", "project-custom"]);
  });

  it("follows a role change at once, since membership isn't stored", async () => {
    await t.db.update(peerAdvisers).set({ studentAssistant: true }).where(eq(peerAdvisers.userId, "amy"));
    expect(await projectIdsFor("amy")).toEqual(["project-peer-advisers", "project-student-assistants"]);
    await t.db.update(peerAdvisers).set({ studentAssistant: false }).where(eq(peerAdvisers.userId, "amy"));
    expect(await projectIdsFor("amy")).toEqual(["project-peer-advisers"]);
  });

  it("gives each Project its Boards and says whether the viewer may manage it", async () => {
    await signIn("sam");
    const response = await getProjects();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({
      projects: [
        { id: "project-peer-advisers", name: "Peer Advisers", defaultKey: "peer_advisers", manage: true,
          boards: [{ id: "board-peer-advisers", name: "Board", boardType: "kanban", position: 1024 }] },
        { id: "project-student-assistants", name: "Student Assistants", defaultKey: "student_assistants", manage: true,
          boards: [{ id: "board-student-assistants", name: "Board", boardType: "kanban", position: 1024 }] },
      ],
    });
    await signIn("amy");
    const plain = await (await getProjects()).json() as { projects: { manage: boolean }[] };
    expect(plain.projects.map((project) => project.manage)).toEqual([false]);
  });
});

describe("GET /api/portal/tasks/boards/[boardId]", () => {
  it("returns the Board's Columns and Tasks in position order, with assignees", async () => {
    await signIn("sam");
    const response = await getBoard("board-student-assistants");
    expect(response.status).toBe(200);
    const body = await response.json() as {
      board: object; columns: { name: string; isDone: boolean; tasks: { id: string; assignees: { userId: string }[] }[] }[];
    };
    expect(body.board).toEqual({ id: "board-student-assistants", name: "Board", boardType: "kanban", archived: false });
    expect(body.columns.map((column) => [column.name, column.isDone, column.tasks.map((task) => task.id)])).toEqual([
      ["Ready", false, ["task-early", "task-late"]],
      ["In Progress", false, []],
      ["Done", true, ["task-done"]],
    ]);
    expect(body.columns[0].tasks[0]).toMatchObject({
      title: "First", dueOn: "2026-12-01", position: 1024, version: 1, description: "",
      assignees: [{ userId: "amy", name: "amy name" }, { userId: "sam", name: "sam name" }],
    });
  });

  it("is open to an Administrator who isn't a Peer Adviser", async () => {
    await signIn("admin");
    expect((await getBoard("board-custom")).status).toBe(200);
  });
});

describe("access to Projects and Boards", () => {
  it("gives a non-member a 404 for a Project and its Boards, the same as for one that doesn't exist", async () => {
    await signIn("amy");
    for (const response of [
      await getProject("project-student-assistants"),
      await getBoard("board-student-assistants"),
      await getProject("project-custom"),
      await getBoard("board-custom"),
      await getProject("project-missing"),
      await getBoard("board-missing"),
    ]) {
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "Not found" });
    }
  });

  it("lets a member read a Project, archived ones included", async () => {
    await signIn("cara");
    const response = await getProject("project-archived");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      project: { id: "project-archived", name: "Old Drive", defaultKey: null, archived: true, manage: false },
      boards: [],
    });
  });

  it("reaches nothing for a User who is neither a Peer Adviser nor an Administrator", async () => {
    await signIn("una");
    for (const response of [await getProjects(), await getProject("project-peer-advisers"), await getBoard("board-peer-advisers")]) {
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "Forbidden" });
    }
    state.current = null;
    for (const response of [await getProjects(), await getProject("project-peer-advisers"), await getBoard("board-peer-advisers")]) {
      expect(response.status).toBe(401);
    }
  });

  it("drops custom membership when the User is no longer a Peer Adviser", async () => {
    await t.db.insert(projectMembers).values({ projectId: "project-custom", userId: "una" });
    await signIn("una");
    expect((await getProject("project-custom")).status).toBe(403);
    await t.db.delete(projectMembers).where(eq(projectMembers.userId, "una"));
  });
});
