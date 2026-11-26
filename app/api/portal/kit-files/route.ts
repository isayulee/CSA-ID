import { getBindings } from "@/lib/cloudflare";
import { runPortalMutation } from "@/lib/portal/access";
import { uploadKitFile } from "@/lib/portal/kit-files";

/** Upload one Teaching Kit PDF as the raw request body. `uploadKitFile` caps and reads the body itself. */
export async function POST(request: Request) {
  return runPortalMutation(request, (db, actor) => uploadKitFile({ db, kv: getBindings().KV }, actor, request), { body: false });
}
