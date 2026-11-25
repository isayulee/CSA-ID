import "server-only";
import { and, eq } from "drizzle-orm";
import type { Db } from "@/lib/auth/session";
import { profiles, publishedProfiles, type Profile } from "@/lib/db/schema";
import * as lifecycle from "@/lib/profile-lifecycle";
import { UploadError, type UploadKind } from "./policy";
import { reencode, storeImage } from "./upload";

/**
 * A Profile's images in KV: the key format, storing a re-encoded upload, and
 * deleting a key only when neither the Draft Profile nor its Published Profile
 * points at it. Callers name a Profile and an image kind, never a raw key.
 */

type ImageOwner = Pick<Profile, "id" | "avatarKey" | "backgroundKey">;

const column = { avatar: "avatarKey", background: "backgroundKey" } as const satisfies Record<UploadKind, keyof ImageOwner>;

const prefix = (profileId: string) => `img/${profileId}/`;
const newKey = (profileId: string, kind: UploadKind) => `${prefix(profileId)}${kind}/${crypto.randomUUID()}.webp`;

/** Matches a key this module made. The /media route serves nothing else. */
export const isImageKey = (key: string) => /^img\/[a-f0-9-]+\/(avatar|background)\/[a-f0-9-]+\.webp$/.test(key);

/** Every key the Draft Profile or its Published Profile points at. */
export async function keysInUse(db: Db, profile: ImageOwner) {
  const [published] = await db.select({ avatarKey: publishedProfiles.avatarKey, backgroundKey: publishedProfiles.backgroundKey })
    .from(publishedProfiles).where(eq(publishedProfiles.profileId, profile.id)).limit(1);
  return new Set([profile.avatarKey, profile.backgroundKey, published?.avatarKey, published?.backgroundKey].filter((key): key is string => Boolean(key)));
}

/**
 * Re-encodes `upload`, stores it under a new key and points the owner's Draft
 * Profile at it. The image it replaced is deleted unless the Published Profile
 * still shows it; that cleanup is best effort, since the new image is already
 * saved. Returns the new key. Throws UploadError when the upload is refused or
 * cannot be saved.
 */
export async function replaceImage(env: { db: Db; kv: KVNamespace; images: ImagesBinding }, owner: { userId: string; profile: ImageOwner }, kind: UploadKind, upload: Uint8Array) {
  const { db, kv } = env;
  const { profile } = owner;
  const key = newKey(profile.id, kind);
  await storeImage(kv, key, await reencode(env.images, upload, kind));
  try {
    await db.update(profiles).set({ [column[kind]]: key }).where(and(eq(profiles.id, profile.id), eq(profiles.userId, owner.userId)));
  } catch {
    await kv.delete(key).catch(() => {});
    throw new UploadError(503, "The image could not be saved. Try again later.");
  }
  const replaced = profile[column[kind]];
  if (replaced) {
    const inUse = await keysInUse(db, { ...profile, [column[kind]]: key }).catch(() => new Set([replaced]));
    if (!inUse.has(replaced)) await kv.delete(replaced).catch(() => {});
  }
  return key;
}

/**
 * Deletes every image the Profile or its Published Profile shows, then clears
 * those keys in D1 with the audit entry. Returns false when there is none.
 *
 * KV goes first on purpose: if D1 then fails, the Profile still holds the keys,
 * so a retry finds and removes them. The other order could leave an abusive
 * image reachable at its /media URL with nothing in D1 pointing to it.
 */
export async function removeImages(env: { db: Db; kv: Pick<KVNamespace, "delete"> }, profile: ImageOwner & Pick<Profile, "slug">, audit: lifecycle.AuditNote) {
  const keys = await keysInUse(env.db, profile);
  if (keys.size === 0) return false;
  await Promise.all([...keys].map((key) => env.kv.delete(key)));
  await lifecycle.clearImageKeys(env.db, profile, audit);
  return true;
}

/** Deletes `known` and every other key under the Profile's prefix, for an account that is already gone from D1. */
export async function deleteAllImages(kv: KVNamespace, profileId: string, known: Set<string>) {
  const keys = new Set(known);
  let cursor: string | undefined;
  do {
    const page = await kv.list({ prefix: prefix(profileId), cursor });
    for (const { name } of page.keys) keys.add(name);
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  await Promise.all([...keys].map((key) => kv.delete(key)));
}
