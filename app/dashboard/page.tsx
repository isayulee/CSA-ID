import { DashboardEditor } from "@/components/dashboard-editor";
import { PortalShell } from "@/components/portal/portal-shell";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getCurrentAccount } from "@/lib/auth/current-user";
import { isAdministrator } from "@/lib/admin";
import { getBindings } from "@/lib/cloudflare";
import { getDb } from "@/lib/db";
import { appearanceOf } from "@/lib/profile-appearance";
import { readProfileEditor } from "@/lib/profile-data";

export default async function DashboardPage() {
  const account = await getCurrentAccount();
  if (!account) redirect("/login");

  const { user } = account;
  const editor = await readProfileEditor(getDb(), user.id);
  if (!editor) redirect("/login");
  const requestHeaders = await headers();
  const host = requestHeaders.get("host");
  const scheme = requestHeaders.get("x-forwarded-proto") === "http" ? "http" : "https";
  const { ADMIN_GOOGLE_SUBS, APP_ORIGIN } = getBindings();
  const profileOrigin = APP_ORIGIN ? new URL(APP_ORIGIN).origin : host ? `${scheme}://${host}` : "";

  return (
    <PortalShell area="profile" preview={process.env.NODE_ENV === "development"}>
      <DashboardEditor
        initial={{
          user: { name: user.name, email: user.email },
          profile: { ...editor.profile, appearance: appearanceOf(editor.profile) },
          links: editor.links.map(({ service, url }) => ({ service, url })),
          hasUnpublishedChanges: editor.hasUnpublishedChanges,
          canReviewReports: isAdministrator(user, ADMIN_GOOGLE_SUBS),
          profileOrigin,
        }}
      />
    </PortalShell>
  );
}
