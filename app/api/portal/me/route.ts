import { runPortalRead } from "@/lib/portal/access";
import { getMySettings } from "@/lib/portal/me";

export async function GET(request: Request) {
  return runPortalRead(request, getMySettings);
}
