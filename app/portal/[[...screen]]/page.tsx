import { notFound } from "next/navigation";
import { PortalPreview } from "@/components/portal/portal-preview";

export const metadata = { title: "Peer Adviser Portal preview", robots: { index: false, follow: false } };

export default async function PortalPage({ params, searchParams }: { params: Promise<{ screen?: string[] }>; searchParams: Promise<{ request?: string | string[] }> }) {
  if (process.env.NODE_ENV !== "development") notFound();
  const { screen = [] } = await params;
  const [area, kitId, action] = screen;
  if (!area) return <PortalPreview area="home" />;
  if (area === "kits" && screen.length <= 3 && (!action || action === "edit" && kitId !== "new")) {
    return <PortalPreview area="kits" kitId={kitId} edit={action === "edit" || kitId === "new"} />;
  }
  if (screen.length === 1 && (area === "scheduler" || area === "directory" || area === "me")) {
    const { request } = await searchParams;
    return <PortalPreview area={area} requestId={typeof request === "string" ? request : undefined} />;
  }
  notFound();
}
