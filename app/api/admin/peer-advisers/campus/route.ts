import { runPortalAdminAction } from "@/lib/portal/access";
import { updatePeerAdviserCampus } from "@/lib/portal/peer-advisers";

export async function POST(request: Request) {
  return runPortalAdminAction(request, updatePeerAdviserCampus);
}
