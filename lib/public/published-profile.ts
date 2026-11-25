import { and, eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "@/lib/db/schema";

type Db = DrizzleD1Database<typeof schema>;

export async function loadPublishedProfile(db: Db, slug: string) {
  const { publishedProfiles, publishedSocialLinks, profiles } = schema;
  const [row] = await db.select({ published: publishedProfiles }).from(publishedProfiles)
    .innerJoin(profiles, and(eq(profiles.id, publishedProfiles.profileId), eq(profiles.status, "published")))
    .where(eq(publishedProfiles.slug, slug)).limit(1);
  if (!row) return null;
  const links = await db.select({ service: publishedSocialLinks.service, url: publishedSocialLinks.url }).from(publishedSocialLinks).where(eq(publishedSocialLinks.profileId, row.published.profileId)).orderBy(publishedSocialLinks.displayOrder);
  return { ...row.published, links };
}
