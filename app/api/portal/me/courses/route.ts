import { runPortalMutation } from "@/lib/portal/access";
import { saveMyCourses } from "@/lib/portal/me";

export async function POST(request: Request) {
  return runPortalMutation(request, saveMyCourses, { maxBytes: 4096 });
}
