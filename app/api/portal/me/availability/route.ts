import { runPortalMutation } from "@/lib/portal/access";
import { saveMyAvailability } from "@/lib/portal/me";

export async function POST(request: Request) {
  return runPortalMutation(request, saveMyAvailability, { maxBytes: 4096 });
}
