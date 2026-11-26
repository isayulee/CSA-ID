import { runPortalAdminAction } from "@/lib/portal/access";
import { mergeCourse } from "@/lib/portal/courses";

export async function POST(request: Request) {
  return runPortalAdminAction(request, mergeCourse);
}
