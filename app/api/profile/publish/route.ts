import { getCurrentAccount } from "@/lib/auth/current-user";
import { getDb } from "@/lib/db";
import { runMutation } from "@/lib/http/action-runner";
import { publish } from "@/lib/profile-lifecycle";

export async function POST(request: Request) {
  return runMutation(request, getCurrentAccount, async ({ profile }) => {
    const result = await publish(getDb(), profile);
    if (!result.ok) return { status: result.status, body: { error: result.error } };
    return { body: { ok: true, slug: result.slug }, changedSlug: result.slug };
  }, { body: false });
}
