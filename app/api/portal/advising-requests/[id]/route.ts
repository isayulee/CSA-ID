import { runPortalRead } from "@/lib/portal/access";
import { readAdvisingRequest } from "@/lib/portal/advising-requests";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return runPortalRead(request, (db, actor) => readAdvisingRequest(db, actor, id));
}
