import { runPortalMutation } from "@/lib/portal/access";
import { updateAdvisingRequest } from "@/lib/portal/advising-requests";

export async function POST(request: Request) {
  return runPortalMutation(request, updateAdvisingRequest, { maxBytes: 8192 });
}
