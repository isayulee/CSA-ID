import { NextResponse } from "next/server";
import { getCurrentAccount } from "@/lib/auth/current-user";
import { getDb } from "@/lib/db";
import { readDraft, saveDraft } from "@/lib/profile-data";
import { isSafeProfileUrl, profileInput } from "@/lib/profile-validation";
import { runMutation } from "@/lib/http/action-runner";

export async function GET() {
  const account = await getCurrentAccount();
  if (!account) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const draft = await readDraft(getDb(), account.user.id);
  if (!draft) return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  return NextResponse.json({ user: account.user, ...draft });
}

export async function PUT(request: Request) {
  return runMutation(request, getCurrentAccount, async ({ user }, body) => {
    const parsed = profileInput.safeParse(body);
    if (!parsed.success) return { status: 400, body: { error: parsed.error.issues[0]?.message || "Invalid profile" } };
    if (parsed.data.links.some((link) => !isSafeProfileUrl(link.service, link.url))) return { status: 400, body: { error: "Use the official HTTPS address for each social platform" } };
    const saved = await saveDraft(getDb(), user.id, parsed.data);
    if (!saved) return { status: 404, body: { error: "Profile not found" } };
    return { body: { ok: true } };
  });
}
