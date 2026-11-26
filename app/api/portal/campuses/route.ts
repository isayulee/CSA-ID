import { runPortalRead } from "@/lib/portal/access";
import { listCampuses } from "@/lib/portal/courses";

export async function GET(request: Request) {
  return runPortalRead(request, (db) => listCampuses(db));
}
