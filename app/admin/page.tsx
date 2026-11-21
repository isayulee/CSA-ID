import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AdminReports } from "@/components/admin-reports";
import { listOpenReports } from "@/lib/admin";
import { getCurrentAdministrator } from "@/lib/auth/current-administrator";
import { getBindings } from "@/lib/cloudflare";
import { getDb } from "@/lib/db";

export const metadata: Metadata = { title: "Abuse Reports", robots: { index: false, follow: false } };

export default async function AdminPage() {
  // Anyone who is not an Administrator, signed in or not, sees the plain 404 page.
  const account = await getCurrentAdministrator();
  if (!account) notFound();
  const { KV, ADMIN_GOOGLE_SUBS } = getBindings();
  const result = await listOpenReports({ db: getDb(), kv: KV, adminSubs: ADMIN_GOOGLE_SUBS }, account.user);
  if (!("reports" in result.body)) notFound();
  return (
    <main className="simplePage adminPage">
      <h1>Abuse Reports</h1>
      <p className="adminLead">Open reports, newest first. Every action needs a reason and is recorded in the audit log.</p>
      <AdminReports reports={result.body.reports} />
    </main>
  );
}
