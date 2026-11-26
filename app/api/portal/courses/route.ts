import { runPortalMutation, runPortalRead } from "@/lib/portal/access";
import { addCourse, listCourses } from "@/lib/portal/courses";

export async function GET(request: Request) {
  return runPortalRead(request, (db) => listCourses(db));
}

export async function POST(request: Request) {
  return runPortalMutation(request, addCourse, { maxBytes: 1024 });
}
