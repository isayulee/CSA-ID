import { runPortalRead } from "@/lib/portal/access";
import { readProjects } from "@/lib/portal/tasks";

export async function GET(request: Request) {
  return runPortalRead(request, readProjects);
}
