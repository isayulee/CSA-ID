import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { adminAuditLog, profiles, publishedProfiles, reservedSlugs, users } from "@/lib/db/schema";
import { UploadError } from "@/lib/images/policy";
import { deleteAllImages, isImageKey, removeImages, replaceImage } from "@/lib/images/profile-images";
import { createTestDb } from "./helpers";

let t: Awaited<ReturnType<typeof createTestDb>>;

function fakeKv() {
  const store = new Map<string, unknown>();
  const failing = { put: false, delete: false };
  const kv = {
    put: async (key: string, value: unknown) => { if (failing.put) throw new Error("KV unavailable"); store.set(key, value); },
    delete: async (key: string) => { if (failing.delete) throw new Error("KV unavailable"); store.delete(key); },
    list: async ({ prefix }: { prefix: string }) => ({ keys: [...store.keys()].filter((name) => name.startsWith(prefix)).map((name) => ({ name })), list_complete: true }),
  };
  return { store, failing, kv: kv as unknown as KVNamespace };
}

const images = {
  info: async () => ({ format: "image/jpeg", fileSize: 4, width: 10, height: 10 }),
  input: () => ({ transform: () => ({ output: async () => ({ response: () => new Response(new Uint8Array([1, 2, 3])) }) }) }),
} as unknown as ImagesBinding;

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
const PROFILE = "0f1e2d3c-0000-4000-8000-000000000001";
const old = `img/${PROFILE}/avatar/00000000-0000-4000-8000-0000000000aa.webp`;
const draftRow = async () => (await t.db.select().from(profiles).where(eq(profiles.id, PROFILE)))[0];

let kv: ReturnType<typeof fakeKv>;

beforeAll(async () => {
  t = await createTestDb();
  await t.db.insert(users).values({ id: "u1", googleSub: "sub-1", email: "one@example.test", name: "One" });
  await t.db.insert(reservedSlugs).values({ slug: "one" });
  await t.db.insert(profiles).values({ id: PROFILE, userId: "u1", slug: "one", displayName: "One", evaluationUrl: "https://forms.example/e" });
});
afterAll(() => t.dispose());

beforeEach(async () => {
  kv = fakeKv();
  kv.store.set(old, "old image");
  await t.db.update(profiles).set({ avatarKey: old, backgroundKey: null }).where(eq(profiles.id, PROFILE));
  await t.db.delete(publishedProfiles).where(eq(publishedProfiles.profileId, PROFILE));
});

const publishWith = (avatarKey: string | null) => t.db.insert(publishedProfiles).values({ profileId: PROFILE, slug: "one", displayName: "One", roleTitle: "r", bio: "", accentColor: "#B5121B", avatarKey, evaluationUrl: "https://forms.example/e" });
const replace = async () => replaceImage({ db: t.db, kv: kv.kv, images }, { userId: "u1", profile: await draftRow() }, "avatar", jpeg);

describe("replaceImage", () => {
  it("keeps the old image while the Published Profile still shows it", async () => {
    await publishWith(old);
    const key = await replace();
    expect(isImageKey(key)).toBe(true);
    expect(key.startsWith(`img/${PROFILE}/avatar/`)).toBe(true);
    expect((await draftRow()).avatarKey).toBe(key);
    expect([...kv.store.keys()].sort()).toEqual([key, old].sort());
  });

  it("deletes the old image once the Published Profile no longer shows it", async () => {
    await publishWith(null);
    const key = await replace();
    expect([...kv.store.keys()]).toEqual([key]);
  });

  it("changes nothing when KV refuses the new image", async () => {
    kv.failing.put = true;
    await expect(replace()).rejects.toBeInstanceOf(UploadError);
    expect((await draftRow()).avatarKey).toBe(old);
    expect([...kv.store.keys()]).toEqual([old]);
  });
});

describe("removeImages", () => {
  const audit = { actorGoogleSub: "admin", reason: "abusive photo" };
  const target = async () => ({ ...(await draftRow()) });

  it("deletes every image the Profile and its Published Profile show and clears both rows", async () => {
    const published = `img/${PROFILE}/avatar/00000000-0000-4000-8000-0000000000bb.webp`;
    kv.store.set(published, "published image");
    await publishWith(published);

    expect(await removeImages({ db: t.db, kv: kv.kv }, await target(), audit)).toBe(true);

    expect(kv.store.size).toBe(0);
    expect((await draftRow()).avatarKey).toBeNull();
    const [snapshot] = await t.db.select().from(publishedProfiles).where(eq(publishedProfiles.profileId, PROFILE));
    expect(snapshot.avatarKey).toBeNull();
    expect(await t.db.select().from(adminAuditLog).where(eq(adminAuditLog.targetId, PROFILE))).toMatchObject([{ action: "remove_images", targetType: "profile", targetLabel: "one", reason: "abusive photo" }]);
  });

  it("keeps the keys in D1 when KV fails, so a retry finds them", async () => {
    kv.failing.delete = true;
    await expect(removeImages({ db: t.db, kv: kv.kv }, await target(), audit)).rejects.toThrow("KV unavailable");
    expect((await draftRow()).avatarKey).toBe(old);
  });

  it("reports false when the Profile shows no image", async () => {
    await t.db.update(profiles).set({ avatarKey: null }).where(eq(profiles.id, PROFILE));
    expect(await removeImages({ db: t.db, kv: kv.kv }, await target(), audit)).toBe(false);
  });
});

describe("deleteAllImages", () => {
  it("deletes the known keys and every other key under the Profile, and nothing of another Profile", async () => {
    const stray = `img/${PROFILE}/background/00000000-0000-4000-8000-0000000000cc.webp`;
    const known = "img/legacy-key.webp";
    const other = "img/0f1e2d3c-0000-4000-8000-000000000002/avatar/00000000-0000-4000-8000-0000000000dd.webp";
    for (const key of [stray, known, other]) kv.store.set(key, "image");

    await deleteAllImages(kv.kv, PROFILE, new Set([known]));

    expect([...kv.store.keys()]).toEqual([other]);
  });
});
