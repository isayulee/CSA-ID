import { runPortalMutation } from "@/lib/portal/access";
import { claimAdvisingRequest } from "@/lib/portal/advising-requests";

export async function POST(request: Request) {
  return runPortalMutation(request, claimAdvisingRequest, { maxBytes: 1024 });
}
