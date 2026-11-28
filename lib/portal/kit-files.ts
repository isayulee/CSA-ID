import "server-only";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { kitFiles, kitItems } from "@/lib/db/schema";
import { portalFail, type PortalActor, type PortalDb, type PortalResult } from "./access";
import { chunk } from "./batch";

/** What the Teaching Kit functions that touch PDF files need. */
export type KitDeps = { db: PortalDb; kv: Pick<KVNamespace, "get" | "put" | "delete"> };

const MAX_KIT_FILE_BYTES = 5 * 1024 * 1024;
/** Teaching Kit PDFs stop here, which keeps the rest of the KV namespace for Profile images (§14.8). */
const KIT_FILES_QUOTA_BYTES = 500 * 1000 * 1000;
const UNATTACHED_GRACE_SECONDS = 24 * 60 * 60;
const PDF_SIGNATURE = new TextEncoder().encode("%PDF-");

const kitFileKey = (id: string) => `kit/${id}.pdf`;
const tooLarge = () => portalFail(413, "Choose a PDF of at most 5 MiB");

async function deleteKeys(kv: KitDeps["kv"], keys: string[]) {
  // The rows are gone already, so a KV key that fails to delete only wastes space; it is never served again.
  await Promise.all(keys.map((key) => kv.delete(key).catch(() => {})));
}

/**
 * Deletes each of these files that no `kit_items` row points at any more: its
 * row first, then its bytes in KV. A file that a racing write attached again
 * keeps its row, because the delete is conditional on no item using it.
 */
export async function deleteUnusedKitFiles({ db, kv }: KitDeps, fileIds: Iterable<string>) {
  const ids = [...new Set(fileIds)];
  for (const part of chunk(ids, 90)) {
    const gone = await db.delete(kitFiles).where(and(inArray(kitFiles.id, part), unattached()))
      .returning({ kvKey: kitFiles.kvKey });
    await deleteKeys(kv, gone.map((row) => row.kvKey));
  }
}

function unattached() {
  return sql`not exists (select 1 from ${kitItems} where ${kitItems.fileId} = ${kitFiles.id})`;
}

/** Deletes uploads that no draft or version picked up within a day (§14.8). */
async function sweepAbandonedKitFiles({ db, kv }: KitDeps) {
  const cutoff = Math.floor(Date.now() / 1000) - UNATTACHED_GRACE_SECONDS;
  const gone = await db.delete(kitFiles).where(and(lt(kitFiles.createdAt, cutoff), unattached()))
    .returning({ kvKey: kitFiles.kvKey });
  await deleteKeys(kv, gone.map((row) => row.kvKey));
}

async function readCapped(request: Request): Promise<Uint8Array | null> {
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_KIT_FILE_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const part of chunks) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return bytes;
}

const isPdf = (bytes: Uint8Array) => PDF_SIGNATURE.every((byte, i) => bytes[i] === byte);

/**
 * Stores one Teaching Kit PDF sent as the raw request body (§14.8). The size is
 * checked from `Content-Length` and again while streaming. The `kit_files` row
 * is written first, only while the total stays under the quota, and the bytes
 * go to KV under the file's own id, never a name from the request.
 */
export async function uploadKitFile(deps: KitDeps, actor: PortalActor, request: Request): Promise<PortalResult> {
  const declared = request.headers.get("content-length");
  if (!declared || !/^\d+$/.test(declared)) return portalFail(411, "The upload size is missing. Try again.");
  if (Number(declared) > MAX_KIT_FILE_BYTES) return tooLarge();
  const bytes = await readCapped(request);
  if (!bytes) return tooLarge();
  if (bytes.byteLength === 0) return portalFail(400, "Choose a PDF to upload");
  if (!isPdf(bytes)) return portalFail(415, "Only PDF files can be added to a Teaching Kit");

  await sweepAbandonedKitFiles(deps);
  const id = crypto.randomUUID();
  const key = kitFileKey(id);
  const size = bytes.byteLength;
  // One statement, so two uploads at once can't both slip under the quota.
  const inserted = await deps.db.run(sql`insert into ${kitFiles} (id, kv_key, size_bytes, uploaded_by_user_id)
    select ${id}, ${key}, ${size}, ${actor.user.id}
    where (select coalesce(sum(size_bytes), 0) from ${kitFiles}) + ${size} <= ${KIT_FILES_QUOTA_BYTES}`);
  if (!inserted.meta.changes) return portalFail(507, "Teaching Kit storage is full. Remove unused PDFs or link the file from Google Drive instead.");
  try {
    await deps.kv.put(key, bytes, { metadata: { contentType: "application/pdf" } });
  } catch {
    await deps.db.delete(kitFiles).where(eq(kitFiles.id, id));
    return portalFail(503, "The PDF could not be saved. Try again later.");
  }
  return { status: 200, body: { ok: true, fileId: id, sizeBytes: size } };
}

/** The bytes of one Teaching Kit PDF, or null. The caller has already checked the reader is a Peer Adviser or Administrator. */
export async function readKitFile({ db, kv }: KitDeps, id: string): Promise<ArrayBuffer | null> {
  if (id.length > 64) return null;
  const [row] = await db.select({ kvKey: kitFiles.kvKey }).from(kitFiles).where(eq(kitFiles.id, id)).limit(1);
  if (!row) return null;
  return kv.get(row.kvKey, "arrayBuffer");
}

/** Headers for serving a Teaching Kit PDF (§14.8). Never cached publicly. */
export const KIT_FILE_HEADERS = {
  "content-type": "application/pdf",
  "x-content-type-options": "nosniff",
  "content-security-policy": "sandbox",
  "cache-control": "private, no-store",
  "content-disposition": "inline",
};
