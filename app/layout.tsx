import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CSA Digital Profile",
  description: "Published Profiles and the private Peer Advisers’ Portal from the Mapúa University CSA.",
  robots: { index: false, follow: false },
  other: {
    "page-type": "software",
    "site-kind": "software",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-type="software" data-radius="soft" data-buttons="solid">
      <body>{children}</body>
    </html>
  );
}
