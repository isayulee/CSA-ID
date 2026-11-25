import { getBindings } from "@/lib/cloudflare";
import { isImageKey } from "@/lib/images/profile-images";

const notFound = () => new Response("Not found", { status: 404, headers: { "cache-control": "public, max-age=60" } });

export async function GET(_: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const key = (await params).key.join("/");
  if (!isImageKey(key)) return notFound();
  const object = await getBindings().KV.getWithMetadata<{ contentType?: string }>(key, "arrayBuffer");
  if (!object.value) return notFound();
  return new Response(object.value, { headers: { "content-type": object.metadata?.contentType || "image/webp", "cache-control": "public, max-age=31536000, immutable", "x-content-type-options": "nosniff" } });
}
