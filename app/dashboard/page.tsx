import { DashboardEditor } from "@/components/dashboard-editor";
import { PortalShell } from "@/components/portal/portal-shell";
import { readCurrentProfileEditor } from "@/lib/profile-editor-data";
import { redirect } from "next/navigation";

export default async function DashboardPage() {
  const initial = await readCurrentProfileEditor();
  if (!initial) redirect("/login");

  return (
    <PortalShell area="profile" preview={process.env.NODE_ENV === "development"}>
      <DashboardEditor initial={initial} />
    </PortalShell>
  );
}
