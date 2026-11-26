import { runPortalRead } from "@/lib/portal/access";
import { readKit } from "@/lib/portal/kits";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return runPortalRead(request, (db, actor) => readKit(db, actor, id));
}
