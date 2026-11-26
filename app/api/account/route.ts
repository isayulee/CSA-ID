import { getCurrentAccount } from "@/lib/auth/current-user";
import { getBindings } from "@/lib/cloudflare";
import { getDb } from "@/lib/db";
import { runMutation } from "@/lib/http/action-runner";
import { deleteAccount } from "@/lib/account-data";

export async function DELETE(request: Request) {
  return runMutation(request, getCurrentAccount, async ({ user }) => {
    let deleted;
    try {
      deleted = await deleteAccount(getDb(), getBindings().KV, user.id);
    } catch {
      return { status: 503, body: { error: "Your account could not be fully deleted. You are still signed in. Try again." } };
    }
    if (!deleted) return { status: 404, body: { error: "Profile not found" } };
    return { body: { ok: true }, changedSlug: deleted.slug, endSession: true };
  }, { body: false });
}
