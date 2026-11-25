import { getCurrentAccount } from "@/lib/auth/current-user";
import { getDb } from "@/lib/db";
import { runMutation } from "@/lib/http/action-runner";
import { unpublish } from "@/lib/profile-lifecycle";

export async function POST(request: Request) {
  return runMutation(request, getCurrentAccount, async ({ profile }) => {
    await unpublish(getDb(), profile.id);
    return { body: { ok: true }, changedSlug: profile.slug };
  }, { body: false });
}
