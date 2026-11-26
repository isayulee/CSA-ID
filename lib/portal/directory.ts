import "server-only";
import { and, eq } from "drizzle-orm";
import { peerAdvisers, profiles, publishedProfiles, users } from "@/lib/db/schema";
import type { PortalDb, PortalResult } from "./access";

/** One Peer Adviser in the Directory (§14.3). `photoUrl` and `profileUrl` are set only for a Published Profile. */
export type DirectoryEntry = {
  userId: string;
  name: string;
  officerPosition: string | null;
  photoUrl: string | null;
  profileUrl: string | null;
};

/**
 * Every Peer Adviser: Officers first by `officer_order`, then everyone else by
 * name. A Published Profile shows its display name, photo and `/id/<slug>` link;
 * a Draft or Suspended Profile, or none, shows `users.name` with neither.
 */
export async function listDirectory(db: PortalDb): Promise<DirectoryEntry[]> {
  const rows = await db.select({
    userId: peerAdvisers.userId,
    userName: users.name,
    officerPosition: peerAdvisers.officerPosition,
    officerOrder: peerAdvisers.officerOrder,
    slug: publishedProfiles.slug,
    displayName: publishedProfiles.displayName,
    avatarKey: publishedProfiles.avatarKey,
  }).from(peerAdvisers)
    .innerJoin(users, eq(users.id, peerAdvisers.userId))
    .leftJoin(profiles, and(eq(profiles.userId, peerAdvisers.userId), eq(profiles.status, "published")))
    .leftJoin(publishedProfiles, eq(publishedProfiles.profileId, profiles.id));
  const entries = rows.map((row) => ({
    order: row.officerOrder ?? Infinity,
    entry: {
      userId: row.userId,
      name: (row.slug && row.displayName) || row.userName,
      officerPosition: row.officerPosition,
      photoUrl: row.slug && row.avatarKey ? `/media/${row.avatarKey}` : null,
      profileUrl: row.slug ? `/id/${row.slug}` : null,
    },
  }));
  entries.sort((a, b) => a.order - b.order || a.entry.name.localeCompare(b.entry.name, "en", { sensitivity: "base" }));
  return entries.map(({ entry }) => entry);
}

export async function readDirectory(db: PortalDb): Promise<PortalResult> {
  return { status: 200, body: { directory: await listDirectory(db) } };
}
