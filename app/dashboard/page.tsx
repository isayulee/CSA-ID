import { DashboardEditor } from "@/components/dashboard-editor";
import { redirect } from "next/navigation";
import { getCurrentAccount } from "@/lib/auth/current-user";
import { getDb } from "@/lib/db";
import { readProfileEditor } from "@/lib/profile-data";

export default async function DashboardPage() {
  const account = await getCurrentAccount();
  if (!account) redirect("/login");

  const { user } = account;
  const editor = await readProfileEditor(getDb(), user.id);
  if (!editor) redirect("/login");

  return (
    <DashboardEditor
      initial={{
        user: { name: user.name, email: user.email },
        profile: editor.profile,
        links: editor.links.map(({ service, url }) => ({ service, url })),
        hasUnpublishedChanges: editor.hasUnpublishedChanges,
      }}
    />
  );
}
