import { runPortalAdminAction } from "@/lib/portal/access";
import { updatePeerAdviserOfficer } from "@/lib/portal/peer-advisers";

export async function POST(request: Request) {
  return runPortalAdminAction(request, updatePeerAdviserOfficer);
}
