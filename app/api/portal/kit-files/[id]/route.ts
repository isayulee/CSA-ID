import { getBindings } from "@/lib/cloudflare";
import { getDb } from "@/lib/db";
import { currentPortalAccount } from "@/lib/portal/access";
import { KIT_FILE_HEADERS, readKitFile } from "@/lib/portal/kit-files";

const PRIVATE = { "cache-control": "private, no-store" };

/** Serves a Teaching Kit PDF to Peer Advisers and Administrators only (§14.8). */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const account = await currentPortalAccount();
  if (!account) return Response.json({ error: "Unauthorized" }, { status: 401, headers: PRIVATE });
  if (!account.actor) return Response.json({ error: "Forbidden" }, { status: 403, headers: PRIVATE });
  const bytes = await readKitFile({ db: getDb(), kv: getBindings().KV }, (await params).id);
  if (!bytes) return Response.json({ error: "File not found" }, { status: 404, headers: PRIVATE });
  return new Response(bytes, { headers: KIT_FILE_HEADERS });
}
