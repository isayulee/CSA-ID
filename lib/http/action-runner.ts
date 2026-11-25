import "server-only";
import { NextResponse } from "next/server";
import type { AdminDeps, AdminResult, Actor } from "@/lib/admin";
import { getCurrentAdministrator } from "@/lib/auth/current-administrator";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { getBindings } from "@/lib/cloudflare";
import { getDb } from "@/lib/db";
import { purgeProfilePage } from "@/lib/edge-cache";
import { guardMutation } from "./mutation-guard";

export type MutationResult = {
  status?: number;
  body: object;
  /** The Slug whose cached public page this action changed. */
  changedSlug?: string | null;
  endSession?: boolean;
};

type GuardOptions = { maxBytes?: number; body?: false };

/**
 * Runs one User or Administrator mutation: `guardMutation` first, then the
 * action, then the cached public page of `changedSlug` is cleared. The write
 * has already committed by then, so a failed clear never fails the request;
 * the cached page expires within a minute anyway (`PROFILE_CACHE_CONTROL`).
 */
export async function runMutation<A>(
  request: Request,
  getAccount: () => Promise<A | null>,
  action: (account: A, body: unknown) => Promise<MutationResult>,
  options: GuardOptions = {},
) {
  const guard = await guardMutation(request, getAccount, options);
  if (!guard.ok) return guard.response;
  const result = await action(guard.account, guard.body);
  if (result.changedSlug) await purgeProfilePage(result.changedSlug, request.url).catch(() => {});
  const response = NextResponse.json(result.body, { status: result.status ?? 200, headers: { "cache-control": "no-store" } });
  if (result.endSession) response.cookies.delete(SESSION_COOKIE);
  return response;
}

/**
 * A User who is not on the allowlist fails the guard's account check, so they
 * get the same 401 as a signed-out visitor and their body is never parsed.
 */
export function runAdminAction(request: Request, action: (deps: AdminDeps, actor: Actor, raw: unknown) => Promise<AdminResult>) {
  return runMutation(request, getCurrentAdministrator, async (account, raw) => {
    const { KV, ADMIN_GOOGLE_SUBS } = getBindings();
    const result = await action({ db: getDb(), kv: KV, adminSubs: ADMIN_GOOGLE_SUBS }, account.user, raw);
    return { ...result, changedSlug: "ok" in result.body ? result.body.slug : null };
  }, { maxBytes: 4096 });
}
