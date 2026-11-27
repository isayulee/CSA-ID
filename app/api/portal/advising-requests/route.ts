import { runPortalRead } from "@/lib/portal/access";
import { listAdvisingRequests } from "@/lib/portal/advising-requests";

export async function GET(request: Request) {
  return runPortalRead(request, listAdvisingRequests);
}
