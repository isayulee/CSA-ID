import { suspendProfile } from "@/lib/admin";
import { runAdminAction } from "@/lib/http/admin-action";

export async function POST(request: Request) {
  return runAdminAction(request, suspendProfile);
}
