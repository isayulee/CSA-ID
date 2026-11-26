import { runPortalRead } from "@/lib/portal/access";
import { listKits } from "@/lib/portal/kits";

export async function GET(request: Request) {
  return runPortalRead(request, listKits);
}
