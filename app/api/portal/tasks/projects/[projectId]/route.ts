import { runPortalRead } from "@/lib/portal/access";
import { readProject } from "@/lib/portal/tasks";

export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return runPortalRead(request, (db, actor) => readProject(db, actor, projectId));
}
