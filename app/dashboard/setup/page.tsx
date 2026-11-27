import { redirect } from "next/navigation";
import { PortalShell } from "@/components/portal/portal-shell";
import { SetupWizard } from "@/components/setup-wizard";
import { readCurrentProfileEditor } from "@/lib/profile-editor-data";

export default async function SetupWizardPage() {
  const initial = await readCurrentProfileEditor();
  if (!initial) redirect("/login");
  if (initial.profile.status !== "draft") redirect("/dashboard");

  return (
    <PortalShell area="profile" preview={process.env.NODE_ENV === "development"}>
      <SetupWizard initial={initial} />
    </PortalShell>
  );
}
