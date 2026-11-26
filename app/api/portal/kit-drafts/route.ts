import { getBindings } from "@/lib/cloudflare";
import { runPortalMutation } from "@/lib/portal/access";
import { saveKitDraft } from "@/lib/portal/kits";

// A full draft is at most 20,000 characters of body plus 50 items.
export async function POST(request: Request) {
  return runPortalMutation(request, (db, actor, raw) => saveKitDraft({ db, kv: getBindings().KV }, actor, raw), { maxBytes: 128 * 1024 });
}
