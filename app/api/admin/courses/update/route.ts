import { runPortalAdminAction } from "@/lib/portal/access";
import { updateCourse } from "@/lib/portal/courses";

export async function POST(request: Request) {
  return runPortalAdminAction(request, updateCourse);
}
