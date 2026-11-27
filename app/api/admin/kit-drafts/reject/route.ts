import { getBindings } from "@/lib/cloudflare";
import { runPortalAdminAction } from "@/lib/portal/access";
import { rejectKitDraft } from "@/lib/portal/kits";

export async function POST(request: Request) {
  return runPortalAdminAction(request, (deps, actor, raw) => rejectKitDraft({ ...deps, kv: getBindings().KV }, actor, raw));
}
