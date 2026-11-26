import { runPortalRead } from "@/lib/portal/access";
import { readBoard } from "@/lib/portal/tasks";

export async function GET(request: Request, { params }: { params: Promise<{ boardId: string }> }) {
  const { boardId } = await params;
  return runPortalRead(request, (db, actor) => readBoard(db, actor, boardId));
}
