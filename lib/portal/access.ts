import "server-only";
import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { notFound } from "next/navigation";
import { NextResponse } from "next/server";
import { isAdministrator, type Actor } from "@/lib/admin";
import { getCurrentAccount } from "@/lib/auth/current-user";
import { getCurrentAdministrator } from "@/lib/auth/current-administrator";
import { getBindings } from "@/lib/cloudflare";
import { getDb } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { runMutation } from "@/lib/http/action-runner";
import type { GuardOptions } from "@/lib/http/mutation-guard";

export type PortalDb = DrizzleD1Database<typeof schema>;

/**
 * Someone allowed into the Portal (§14.1): a Peer Adviser, an Administrator, or
 * both. Every Portal function takes this from the Session and never a User ID
 * from the request.
 */
export type PortalActor = {
  user: Pick<schema.User, "id" | "googleSub" | "name">;
  isPeerAdviser: boolean;
  isAdministrator: boolean;
};

/** What every Administrator function in the Portal needs. `adminSubs` is the ADMIN_GOOGLE_SUBS Worker secret. */
export type PortalAdminDeps = { db: PortalDb; adminSubs: string | undefined };

export type PortalResult = { status: number; body: object };

export const portalFail = (status: number, error: string): PortalResult => ({ status, body: { error } });

/** The Portal rights of a signed-in User: a `peer_advisers` row or the Administrator allowlist, else null. */
export async function loadPortalActor(db: PortalDb, user: PortalActor["user"], adminSubs: string | undefined): Promise<PortalActor | null> {
  const [row] = await db.select({ userId: schema.peerAdvisers.userId }).from(schema.peerAdvisers)
    .where(eq(schema.peerAdvisers.userId, user.id)).limit(1);
  const administrator = isAdministrator(user, adminSubs);
  if (!row && !administrator) return null;
  return { user: { id: user.id, googleSub: user.googleSub, name: user.name }, isPeerAdviser: Boolean(row), isAdministrator: administrator };
}

/** The signed-in User with their Portal rights; `actor` is null when they may not open the Portal. */
async function currentPortalAccount() {
  const account = await getCurrentAccount();
  if (!account) return null;
  return { actor: await loadPortalActor(getDb(), account.user, getBindings().ADMIN_GOOGLE_SUBS) };
}

/** The Session's Peer Adviser or Administrator, or null for everyone else (§14.2). */
export async function requirePeerAdviser(): Promise<PortalActor | null> {
  return (await currentPortalAccount())?.actor ?? null;
}

/** For Portal pages: everyone who isn't a Peer Adviser or Administrator gets the plain 404 page. */
export async function requirePeerAdviserPage(): Promise<PortalActor> {
  const actor = await requirePeerAdviser();
  if (!actor) notFound();
  return actor;
}

const PRIVATE = { "cache-control": "private, no-store" };

/**
 * Runs one Portal read for a GET endpoint. A signed-out visitor gets a 401 and a
 * signed-in User who isn't a Peer Adviser or Administrator a 403; `read` runs
 * only for those allowed in.
 */
export async function runPortalRead(request: Request, read: (db: PortalDb, actor: PortalActor, url: URL) => Promise<PortalResult>) {
  const account = await currentPortalAccount();
  if (!account) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: PRIVATE });
  if (!account.actor) return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: PRIVATE });
  const result = await read(getDb(), account.actor, new URL(request.url));
  return NextResponse.json(result.body, { status: result.status, headers: PRIVATE });
}

/**
 * Runs one Peer Adviser mutation through `guardMutation`. A signed-in User who
 * isn't a Peer Adviser or Administrator gets a 403 before their body is read.
 */
export function runPortalMutation(
  request: Request,
  action: (db: PortalDb, actor: PortalActor, raw: unknown) => Promise<PortalResult>,
  options: Omit<GuardOptions, "authorize"> = {},
) {
  return runMutation(request, currentPortalAccount, (account, raw) => action(getDb(), account.actor!, raw), {
    ...options,
    authorize: (account) => account.actor !== null,
  });
}

/**
 * Runs one Administrator action in the Portal. Like the other Administrator
 * routes, a User who is not on the allowlist gets the signed-out 401 and their
 * body is never parsed; the action checks the allowlist again itself.
 */
export function runPortalAdminAction(request: Request, action: (deps: PortalAdminDeps, actor: Actor, raw: unknown) => Promise<PortalResult>) {
  return runMutation(request, getCurrentAdministrator, (account, raw) =>
    action({ db: getDb(), adminSubs: getBindings().ADMIN_GOOGLE_SUBS }, account.user, raw), { maxBytes: 4096 });
}
