import { PortalShell } from "@/components/portal/portal-shell";
import { TasksBoard, TasksProjects } from "@/components/portal/tasks";
import { getDb } from "@/lib/db";
import { requirePeerAdviserPage } from "@/lib/portal/access";
import { listProjects, loadBoard } from "@/lib/portal/tasks";
import { notFound } from "next/navigation";
import { AdviserDesk } from "@/components/portal/adviser-desk";
import { readCurrentProfileEditor } from "@/lib/profile-editor-data";

export const metadata = { title: "Adviser Desk", robots: { index: false, follow: false } };

type PortalPageProps = {
  params: Promise<{ screen?: string[] }>;
  searchParams: Promise<{ request?: string | string[]; view?: string | string[]; task?: string | string[]; role?: string | string[] }>;
};

export default async function PortalPage({ params, searchParams }: PortalPageProps) {
  const { screen = [] } = await params;
  const [area, itemId, action] = screen;
  if (area === "tasks" && screen.length <= 2) {
    const actor = await requirePeerAdviserPage();
    const db = getDb();

    if (!itemId) {
      return <PortalShell area="tasks" preview={false} showTasks>
        <TasksProjects projects={await listProjects(db, actor)} />
      </PortalShell>;
    }

    const board = await loadBoard(db, actor, itemId);
    if (!board) notFound();
    return <PortalShell area="tasks" preview={false} showTasks>
      <TasksBoard data={board} viewerId={actor.user.id} />
    </PortalShell>;
  }

  if (process.env.NODE_ENV !== "development") notFound();
  if (!area) return <AdviserDesk area="home" />;
  if (area === "kits" && screen.length <= 3 && (!action || (action === "edit" && itemId !== "new"))) {
    return <AdviserDesk area="kits" kitId={itemId} editKit={action === "edit" || itemId === "new"} />;
  }
  if (area === "tasks-preview" && screen.length <= 2) {
    if (itemId && !["peer-advisers", "officers", "student-assistants"].includes(itemId)) notFound();
    const { view, task, role } = await searchParams;
    return <AdviserDesk area="tasks" tasksPrototype={{
      boardId: itemId,
      view: view === "focus" ? "focus" : "board",
      taskId: typeof task === "string" ? task : undefined,
      role: role === "assistant" || role === "administrator" ? role : "peer",
    }} />;
  }
  if (screen.length !== 1) notFound();
  if (area === "profile") return <AdviserDesk area="profile" profileEditor={await readCurrentProfileEditor()} />;
  if (area === "scheduler") {
    const { request } = await searchParams;
    return <AdviserDesk area="scheduler" requestId={typeof request === "string" ? request : undefined} />;
  }
  if (area === "directory" || area === "me") return <AdviserDesk area={area} />;
  notFound();
}
