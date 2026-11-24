import "server-only";
import { NextResponse } from "next/server";
import type { AdminDeps, AdminResult, Actor } from "@/lib/admin";
import { getCurrentAdministrator } from "@/lib/auth/current-administrator";
import { getBindings } from "@/lib/cloudflare";
import { getDb } from "@/lib/db";
import { purgeProfilePage } from "@/lib/edge-cache";
import { guardMutation } from "./mutation-guard";

const MAX_BODY_BYTES = 4096;

/**
 * Runs one Administrator action behind the mutation guard. A User who is not on
 * the allowlist fails the guard's account check, so they get the same 401 as a
 * signed-out visitor and their body is never parsed. On success the Profile's
 * edge-cached public page is purged.
 */
export async function runAdminAction(request: Request, action: (deps: AdminDeps, actor: Actor, raw: unknown) => Promise<AdminResult>) {
  const guard = await guardMutation(request, getCurrentAdministrator, { maxBytes: MAX_BODY_BYTES });
  if (!guard.ok) return guard.response;
  const { KV, ADMIN_GOOGLE_SUBS } = getBindings();
  const result = await action({ db: getDb(), kv: KV, adminSubs: ADMIN_GOOGLE_SUBS }, guard.account.user, guard.body);
  if ("ok" in result.body && result.body.slug) await purgeProfilePage(result.body.slug, request.url);
  return NextResponse.json(result.body, { status: result.status });
}
