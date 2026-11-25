import { getCurrentAccount } from "@/lib/auth/current-user";
import { getDb } from "@/lib/db";
import { runMutation } from "@/lib/http/action-runner";
import { claimSlug } from "@/lib/profile-data";

export async function POST(request: Request) {
  return runMutation(request, getCurrentAccount, async ({ user }, body) => {
    const result = await claimSlug(getDb(), user.id, (body as { slug?: unknown } | null)?.slug);
    if (!result.ok) return { status: result.status, body: { error: result.message } };
    return { body: { ok: true, slug: result.slug } };
  }, { maxBytes: 1024 });
}
