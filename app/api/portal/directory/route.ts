import { runPortalRead } from "@/lib/portal/access";
import { readDirectory } from "@/lib/portal/directory";

export async function GET(request: Request) {
  return runPortalRead(request, readDirectory);
}
