import { notFound } from "next/navigation";
import { PortalPreview } from "@/components/portal/portal-preview";

export const metadata = { title: "Administrator preview", robots: { index: false, follow: false } };

export default async function AdminPreviewPage({ params }: { params: Promise<{ screen: string }> }) {
  if (process.env.NODE_ENV !== "development") notFound();
  const { screen } = await params;
  if (screen !== "peer-advisers" && screen !== "kit-drafts" && screen !== "assignments") notFound();
  return <PortalPreview area={screen} />;
}
