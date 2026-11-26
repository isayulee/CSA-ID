"use client";

import Link from "next/link";
import { useRef, type ReactNode } from "react";
import { PortalGeometry } from "./portal-geometry";
import styles from "./portal.module.css";

const navigation = [
  { area: "home", href: "/portal", label: "Home" },
  { area: "scheduler", href: "/portal/scheduler", label: "Scheduler" },
  { area: "kits", href: "/portal/kits", label: "Teaching Kits" },
  { area: "directory", href: "/portal/directory", label: "Directory" },
  { area: "me", href: "/portal/me", label: "Settings" },
  { area: "profile", href: "/dashboard", label: "Profile" },
] as const;

const administration = [
  { area: "peer-advisers", href: "/admin/peer-advisers", label: "Peer Adviser approvals" },
  { area: "kit-drafts", href: "/admin/kit-drafts", label: "Kit Draft reviews" },
] as const;

const icons = {
  home: "M3 10l9-7 9 7v10h-6v-6H9v6H3z",
  scheduler: "M4 6h16v14H4z M8 3v6 M16 3v6 M4 11h16 M8 15h4 M8 18h7",
  kits: "M3 6h7l2 2h9v12H3z",
  directory: "M16 20H3v-2a4 4 0 0 1 4-4h5a4 4 0 0 1 4 4z M13 7a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0z M18 4a3 3 0 0 1 0 6 M18 14a4 4 0 0 1 3 4v2",
  me: "M4 6h16 M4 12h16 M4 18h16 M8 4v4 M16 10v4 M10 16v4",
  menu: "M4 6h16 M4 12h16 M4 18h16",
  profile: "M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0z M14.5 10a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z M7 17a6 6 0 0 1 10 0",
} as const;

function Icon({ name }: { name: keyof typeof icons }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={icons[name]} /></svg>;
}

type PortalArea = (typeof navigation)[number]["area"] | (typeof administration)[number]["area"];

export function PortalShell({ area, preview, children }: { area: PortalArea; preview: boolean; children: ReactNode }) {
  const drawer = useRef<HTMLDialogElement>(null);
  const isAdmin = administration.some((item) => item.area === area);
  const items = preview ? navigation : navigation.filter((item) => item.area === "profile");
  const home = preview ? "/portal" : "/dashboard";
  const closeDrawer = () => drawer.current?.close();

  const menu = (mobile = false) => {
    const onNavigate = mobile ? () => drawer.current?.close() : undefined;
    return <>
      <Link className={styles.wordmark} href={home} onClick={onNavigate}>Peer Adviser<br />Portal</Link>
      <nav className={styles.sideNav} aria-label="Portal">
        {items.map((item) => (
          <Link key={item.area} href={item.href} aria-current={area === item.area ? "page" : undefined} onClick={onNavigate}>
            <Icon name={item.area} />{item.label}
          </Link>
        ))}
      </nav>
      {preview && <nav className={styles.adminNav} aria-label="Administrator preview">
        <p>Administrator preview</p>
        {administration.map((item) => <Link key={item.area} href={item.href} aria-current={area === item.area ? "page" : undefined} onClick={onNavigate}>{item.label}</Link>)}
        <Link href="/admin" onClick={onNavigate}>Abuse Reports</Link>
      </nav>}
    </>;
  };

  return (
    <div className={styles.portal} data-shortcuts={preview || undefined}>
      <a className="skipLink" href="#portal-main">Skip to content</a>
      <aside className={styles.sidebar}>{menu()}<PortalGeometry corner="sidebar" /></aside>
      <header className={styles.mobileHeader}>
        {preview && <button type="button" aria-label="Open Portal navigation" onClick={() => drawer.current?.showModal()}><Icon name="menu" /></button>}
        <Link href={home}>Peer Adviser Portal</Link>
      </header>
      {preview && <dialog className={styles.drawer} ref={drawer} aria-label="Portal navigation">
        <button className={styles.close} type="button" aria-label="Close Portal navigation" onClick={closeDrawer}>×</button>
        {menu(true)}
      </dialog>}
      <main id="portal-main" className={styles.workspace}>
        {area !== "profile" && <p className={styles.previewNotice}>Local preview · {isAdmin ? "Administrator" : "Peer Adviser"} · Fictional data. Changes stay in this tab.</p>}
        <PortalGeometry corner="workspace" />
        {children}
      </main>
      {preview && <nav className={styles.bottomNav} aria-label="Portal shortcuts">
        {items.map((item) => <Link href={item.href} key={item.area} aria-current={area === item.area ? "page" : undefined}><Icon name={item.area} />{item.label}</Link>)}
      </nav>}
    </div>
  );
}
