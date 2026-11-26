import { runPortalAdminAction } from "@/lib/portal/access";
import { addCampus } from "@/lib/portal/courses";

export async function POST(request: Request) {
  return runPortalAdminAction(request, addCampus);
}
