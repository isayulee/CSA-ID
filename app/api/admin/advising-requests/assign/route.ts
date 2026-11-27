import { runPortalAdminAction } from "@/lib/portal/access";
import { assignAdvisingRequest } from "@/lib/portal/advising-requests";

export async function POST(request: Request) {
  return runPortalAdminAction(request, assignAdvisingRequest);
}
