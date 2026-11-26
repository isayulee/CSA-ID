import { runPortalMutation } from "@/lib/portal/access";
import { saveMyCampus } from "@/lib/portal/me";

export async function POST(request: Request) {
  return runPortalMutation(request, saveMyCampus, { maxBytes: 1024 });
}
