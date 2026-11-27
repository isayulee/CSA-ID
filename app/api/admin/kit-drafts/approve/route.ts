import { getBindings } from "@/lib/cloudflare";
import { runPortalAdminAction } from "@/lib/portal/access";
import { approveKitDraft } from "@/lib/portal/kits";

export async function POST(request: Request) {
  return runPortalAdminAction(request, (deps, actor, raw) => approveKitDraft({ ...deps, kv: getBindings().KV }, actor, raw));
}
