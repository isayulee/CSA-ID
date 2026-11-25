import { NextResponse } from "next/server";
import { getCurrentAccount } from "@/lib/auth/current-user";
import { guardMutation } from "@/lib/http/mutation-guard";
import { getBindings } from "@/lib/cloudflare";
import { getDb } from "@/lib/db";
import { UploadError } from "@/lib/images/policy";
import { replaceImage } from "@/lib/images/profile-images";
import { readUpload } from "@/lib/images/upload";

const noStore = { "cache-control": "no-store" };
const fail = (status: number, error: string) => NextResponse.json({ error }, { status, headers: noStore });

export async function POST(request: Request, { params }: { params: Promise<{ kind: string }> }) {
  const guard = await guardMutation(request, getCurrentAccount, { body: false });
  if (!guard.ok) return guard.response;
  const { account } = guard;
  const { kind } = await params;
  if (kind !== "avatar" && kind !== "background") return fail(404, "Unknown upload type");
  const env = getBindings();
  if (!env.IMAGES) return fail(503, "Image processing is not configured");

  let key: string;
  try {
    const upload = await readUpload(request, kind);
    key = await replaceImage({ db: getDb(), kv: env.KV, images: env.IMAGES }, { userId: account.user.id, profile: account.profile }, kind, upload);
  } catch (error) {
    if (error instanceof UploadError) return fail(error.status, error.message);
    return fail(500, "The image could not be processed");
  }
  return NextResponse.json({ ok: true, url: `/media/${key}` }, { headers: noStore });
}
