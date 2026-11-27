import "server-only";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { boardColumns, boards, peerAdvisers, projectMembers, projects, taskAssignees, tasks, users } from "@/lib/db/schema";
import { portalFail, type PortalActor, type PortalDb, type PortalResult } from "./access";

type Project = typeof projects.$inferSelect;

/**
 * What the viewer may do in one Project (§15.2): `read` for every member, `manage` for an SA member
 * or an Administrator. Later tickets add the move, Task, Board and Column checks on top of `manage`.
 */
export type ProjectAccess = { project: Project; manage: boolean };

/** The viewer's own Peer Adviser roles, read from the Session's User and never from the request. */
async function loadRoles(db: PortalDb, actor: PortalActor) {
  if (!actor.isPeerAdviser) return null;
  const [row] = await db.select({ studentAssistant: peerAdvisers.studentAssistant, officerPosition: peerAdvisers.officerPosition })
    .from(peerAdvisers).where(eq(peerAdvisers.userId, actor.user.id)).limit(1);
  return row ? { studentAssistant: row.studentAssistant, officer: row.officerPosition !== null } : null;
}

type Roles = Awaited<ReturnType<typeof loadRoles>>;

/** Default membership comes from roles (§15.1); custom membership from `project_members`, Peer Advisers only. */
function isMember(project: Project, roles: Roles, customMemberships: Set<string>) {
  if (!roles) return false;
  switch (project.defaultKey) {
    case "peer_advisers": return true;
    case "student_assistants": return roles.studentAssistant;
    case "officers": return roles.officer;
    default: return customMemberships.has(project.id);
  }
}

async function customMembershipsOf(db: PortalDb, userId: string, projectIds?: string[]) {
  const rows = await db.select({ projectId: projectMembers.projectId }).from(projectMembers)
    .where(projectIds ? and(eq(projectMembers.userId, userId), inArray(projectMembers.projectId, projectIds)) : eq(projectMembers.userId, userId));
  return new Set(rows.map((row) => row.projectId));
}

function accessFor(project: Project, actor: PortalActor, roles: Roles, customMemberships: Set<string>): ProjectAccess | null {
  if (actor.isAdministrator) return { project, manage: true };
  if (!isMember(project, roles, customMemberships)) return null;
  return { project, manage: Boolean(roles?.studentAssistant) };
}

/**
 * The one access check every Tasks read and write calls (§15.2). Null when the Project doesn't exist or
 * the viewer isn't a member and isn't an Administrator, so callers answer both with the same 404.
 */
export async function projectAccess(db: PortalDb, actor: PortalActor, projectId: string): Promise<ProjectAccess | null> {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) return null;
  const [roles, memberships] = await Promise.all([loadRoles(db, actor), customMembershipsOf(db, actor.user.id, [projectId])]);
  return accessFor(project, actor, roles, memberships);
}

export type BoardSummary = { id: string; name: string; boardType: string; position: number };
export type ProjectSummary = { id: string; name: string; defaultKey: Project["defaultKey"]; manage: boolean; boards: BoardSummary[] };

/** The viewer's Projects that aren't archived, defaults first, each with its Boards that aren't archived, in position order. */
export async function listProjects(db: PortalDb, actor: PortalActor): Promise<ProjectSummary[]> {
  const [all, roles, memberships] = await Promise.all([
    db.select().from(projects).where(isNull(projects.archivedAt)),
    loadRoles(db, actor),
    customMembershipsOf(db, actor.user.id),
  ]);
  const visible = all.flatMap((project) => accessFor(project, actor, roles, memberships) ?? []);
  if (visible.length === 0) return [];
  const boardRows = await db.select({ id: boards.id, projectId: boards.projectId, name: boards.name, boardType: boards.boardType, position: boards.position })
    .from(boards)
    .where(and(inArray(boards.projectId, visible.map(({ project }) => project.id)), isNull(boards.archivedAt)))
    .orderBy(asc(boards.position), asc(boards.id));
  const defaultOrder = (project: Project) => ["peer_advisers", "student_assistants", "officers"].indexOf(project.defaultKey ?? "");
  return visible
    .sort((a, b) => {
      const [x, y] = [defaultOrder(a.project), defaultOrder(b.project)];
      if (x !== y) return (x === -1 ? Infinity : x) - (y === -1 ? Infinity : y);
      return a.project.name.localeCompare(b.project.name, "en", { sensitivity: "base" });
    })
    .map(({ project, manage }) => ({
      id: project.id,
      name: project.name,
      defaultKey: project.defaultKey,
      manage,
      boards: boardRows.filter((board) => board.projectId === project.id)
        .map((board) => ({ id: board.id, name: board.name, boardType: board.boardType, position: board.position })),
    }));
}

export async function readProjects(db: PortalDb, actor: PortalActor): Promise<PortalResult> {
  return { status: 200, body: { projects: await listProjects(db, actor) } };
}

const NOT_FOUND = () => portalFail(404, "Not found");

/** One Project with its Boards, archived ones included and marked, since a member may still read them. */
export async function readProject(db: PortalDb, actor: PortalActor, projectId: string): Promise<PortalResult> {
  const access = await projectAccess(db, actor, projectId);
  if (!access) return NOT_FOUND();
  const boardRows = await db.select({ id: boards.id, name: boards.name, boardType: boards.boardType, position: boards.position, archivedAt: boards.archivedAt })
    .from(boards).where(eq(boards.projectId, projectId)).orderBy(asc(boards.position), asc(boards.id));
  const { project, manage } = access;
  return {
    status: 200,
    body: {
      project: { id: project.id, name: project.name, defaultKey: project.defaultKey, archived: project.archivedAt !== null, manage },
      boards: boardRows.map(({ archivedAt, ...board }) => ({ ...board, archived: archivedAt !== null })),
    },
  };
}

export type TaskView = {
  id: string;
  title: string;
  description: string;
  dueOn: string | null;
  position: number;
  version: number;
  assignees: { userId: string; name: string }[];
};

export async function loadBoard(db: PortalDb, actor: PortalActor, boardId: string) {
  const [board] = await db.select().from(boards).where(eq(boards.id, boardId)).limit(1);
  if (!board) return null;
  const access = await projectAccess(db, actor, board.projectId);
  if (!access) return null;

  const [columnRows, taskRows, assigneeRows] = await db.batch([
    db.select({ id: boardColumns.id, name: boardColumns.name, position: boardColumns.position, isDone: boardColumns.isDone })
      .from(boardColumns).where(eq(boardColumns.boardId, boardId)).orderBy(asc(boardColumns.position), asc(boardColumns.id)),
    db.select({
      id: tasks.id, columnId: tasks.columnId, title: tasks.title, description: tasks.description,
      dueOn: tasks.dueOn, position: tasks.position, version: tasks.version,
    }).from(tasks).where(eq(tasks.boardId, boardId)).orderBy(asc(tasks.position), asc(tasks.id)),
    db.select({ taskId: taskAssignees.taskId, userId: taskAssignees.userId, name: users.name })
      .from(taskAssignees)
      .innerJoin(tasks, eq(tasks.id, taskAssignees.taskId))
      .innerJoin(users, eq(users.id, taskAssignees.userId))
      .where(eq(tasks.boardId, boardId))
      .orderBy(asc(users.name), asc(users.id)),
  ]);

  const assignees = new Map<string, TaskView["assignees"]>();
  for (const { taskId, userId, name } of assigneeRows) {
    const list = assignees.get(taskId) ?? [];
    list.push({ userId, name });
    assignees.set(taskId, list);
  }
  const tasksByColumn = new Map<string, TaskView[]>();
  for (const { columnId, ...task } of taskRows) {
    const list = tasksByColumn.get(columnId) ?? [];
    list.push({ ...task, assignees: assignees.get(task.id) ?? [] });
    tasksByColumn.set(columnId, list);
  }

  const { project, manage } = access;
  return {
    project: { id: project.id, name: project.name, archived: project.archivedAt !== null, manage },
    board: { id: board.id, name: board.name, boardType: board.boardType, archived: board.archivedAt !== null },
    columns: columnRows.map((column) => ({ ...column, tasks: tasksByColumn.get(column.id) ?? [] })),
  };
}

/** One Board with its Columns and their Tasks, each in position order. A 404 when the viewer can't reach its Project. */
export async function readBoard(db: PortalDb, actor: PortalActor, boardId: string): Promise<PortalResult> {
  const body = await loadBoard(db, actor, boardId);
  return body ? { status: 200, body } : NOT_FOUND();
}
