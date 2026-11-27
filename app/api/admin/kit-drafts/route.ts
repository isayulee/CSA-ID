import { runPortalRead } from "@/lib/portal/access";
import { listPendingKitDrafts } from "@/lib/portal/kits";

export async function GET(request: Request) {
  return runPortalRead(request, listPendingKitDrafts);
}
