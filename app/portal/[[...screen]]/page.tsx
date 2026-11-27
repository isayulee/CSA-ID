import { notFound } from "next/navigation";
import { AdviserDesk } from "@/components/portal/adviser-desk";
import { readCurrentProfileEditor } from "@/lib/profile-editor-data";

export const metadata = { title: "Adviser Desk", robots: { index: false, follow: false } };

type PortalPageProps = {
  params: Promise<{ screen?: string[] }>;
  searchParams: Promise<{ request?: string | string[]; view?: string | string[]; task?: string | string[]; role?: string | string[] }>;
};

export default async function PortalPage({ params, searchParams }: PortalPageProps) {
  if (process.env.NODE_ENV !== "development") notFound();

  const { screen = [] } = await params;
  const [area, kitId, action] = screen;
  if (!area) return <AdviserDesk area="home" />;
  if (area === "kits" && screen.length <= 3 && (!action || (action === "edit" && kitId !== "new"))) {
    return <AdviserDesk area="kits" kitId={kitId} editKit={action === "edit" || kitId === "new"} />;
  }
  if (area === "tasks" && screen.length <= 2) {
    if (kitId && !["peer-advisers", "officers", "student-assistants"].includes(kitId)) notFound();
    const { view, task, role } = await searchParams;
    return <AdviserDesk area="tasks" tasksPrototype={{
      boardId: kitId,
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
