import { removeProfileImages } from "@/lib/admin";
import { runAdminAction } from "@/lib/http/action-runner";

export async function POST(request: Request) {
  return runAdminAction(request, removeProfileImages);
}
