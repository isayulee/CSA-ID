import { runPortalAdminAction } from "@/lib/portal/access";
import { deleteCourse } from "@/lib/portal/courses";

export async function POST(request: Request) {
  return runPortalAdminAction(request, deleteCourse);
}
