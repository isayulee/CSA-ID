import { NextResponse } from "next/server";
import { getCurrentAccount } from "@/lib/auth/current-user";
import { guardMutation } from "@/lib/http/mutation-guard";
import { getDb } from "@/lib/db";
import { purgeProfilePage } from "@/lib/edge-cache";
import { publish } from "@/lib/profile-lifecycle";

export async function POST(request: Request) {
  const guard = await guardMutation(request, getCurrentAccount, { body: false });
  if (!guard.ok) return guard.response;
  const result = await publish(getDb(), guard.account.profile);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  await purgeProfilePage(result.slug, request.url);
  return NextResponse.json({ ok: true, slug: result.slug });
}
