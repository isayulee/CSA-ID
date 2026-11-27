import { DashboardEditor } from "@/components/dashboard-editor";
import { PortalShell } from "@/components/portal/portal-shell";
import { requirePeerAdviser } from "@/lib/portal/access";
import { readCurrentProfileEditor } from "@/lib/profile-editor-data";
import { redirect } from "next/navigation";

export default async function DashboardPage() {
  const initial = await readCurrentProfileEditor();
  if (!initial) redirect("/login");

  const canOpenTasks = Boolean(await requirePeerAdviser());

  return (
    <PortalShell area="profile" showTasks={canOpenTasks} preview={process.env.NODE_ENV === "development"}>
      <DashboardEditor initial={initial} />
    </PortalShell>
  );
}
