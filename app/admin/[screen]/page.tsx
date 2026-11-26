import { notFound, redirect } from "next/navigation";
import { AdminPortalPreview } from "@/components/portal/admin-portal-preview";

export const metadata = { title: "Administrator preview", robots: { index: false, follow: false } };

export default async function AdminPreviewPage({ params }: { params: Promise<{ screen: string }> }) {
  if (process.env.NODE_ENV !== "development") notFound();
  const { screen } = await params;
  if (screen === "assignments") redirect("/portal/scheduler");
  if (screen !== "peer-advisers" && screen !== "kit-drafts") notFound();
  return <AdminPortalPreview area={screen} />;
}
