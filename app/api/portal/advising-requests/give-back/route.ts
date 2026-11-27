import { runPortalMutation } from "@/lib/portal/access";
import { giveBackAdvisingRequest } from "@/lib/portal/advising-requests";

export async function POST(request: Request) {
  return runPortalMutation(request, giveBackAdvisingRequest, { maxBytes: 1024 });
}
