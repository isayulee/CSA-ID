"use client";

import Link from "next/link";
import { useRef, useSyncExternalStore } from "react";
import { MapuaSquares } from "@/components/mapua-squares";
import { Settings, Directory, PeerAdviserApprovals } from "./people";
import { Scheduler } from "./scheduler";
import { TeachingKits, KitReviews } from "./teaching-kits";
import { academicTerm, getPreview, getSeed, peerId, statuses, subscribe, type PreviewState } from "./model";
import styles from "./portal.module.css";

type Area = "home" | "kits" | "scheduler" | "directory" | "me" | "peer-advisers" | "kit-drafts" | "assignments";

const navigation = [
  { area: "home", href: "/portal", label: "Home", mobile: "Home" },
  { area: "scheduler", href: "/portal/scheduler", label: "Scheduler", mobile: "Scheduler" },
  { area: "kits", href: "/portal/kits", label: "Teaching Kits", mobile: "Teaching Kits" },
  { area: "directory", href: "/portal/directory", label: "Directory", mobile: "Directory" },
  { area: "me", href: "/portal/me", label: "Settings", mobile: "Settings" },
] as const;

const administration = [
  { area: "peer-advisers", href: "/admin/peer-advisers", label: "Peer Adviser approvals" },
  { area: "assignments", href: "/admin/assignments", label: "Advising Request assignments" },
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

function PreviewHome({ state }: { state: PreviewState }) {
  const adviser = state.advisers.find((item) => item.id === peerId);
  const claimed = state.requests.filter((item) => item.claimant === peerId);
  const kits = state.kits.filter((kit) => adviser?.courses.includes(kit.course));
  const open = claimed.filter((item) => item.status === "pending" || item.status === "rescheduled");

  return (
    <div className={styles.overview}>
      <section>
        <h1>Adviser Overview</h1>
        <div className={styles.summary}>
          <span>Open Advising Requests</span>
          <strong>{open.length}</strong>
          <Link href="/portal/scheduler">Open Scheduler <span aria-hidden="true">→</span></Link>
        </div>
        <div className={styles.sectionHeading}><h2>Teaching Kits for your Courses</h2><Link href="/portal/kits">View all</Link></div>
        {kits.length === 0 ? <p className={styles.panel}>There are no approved Teaching Kits for your Courses yet.</p> :
          <div className={styles.kitsGrid}>{kits.map((kit, index) => (
            <Link href={`/portal/kits/${kit.id}`} key={kit.id} className={styles.kitTile} data-tone={index % 3}>
              <span className={styles.badge}>{kit.course}</span>
              <div><h3>{kit.title}</h3><small>{academicTerm(kit.year, kit.term)}</small></div>
            </Link>
          ))}</div>}
      </section>
      <aside className={styles.pendingRail} aria-labelledby="claimed-heading">
        <h2 id="claimed-heading">My Advising Requests</h2>
        {claimed.length === 0 && <p>No claimed Advising Requests.</p>}
        {claimed.map((request) => (
          <Link className={styles.panel} href={`/portal/scheduler?request=${request.id}`} key={request.id}>
            <span className={styles.badge} data-status={request.status}>{statuses[request.status]}</span>
            <h3>{request.course}</h3><p>{request.topic}</p><small>{request.campus}</small>
          </Link>
        ))}
      </aside>
    </div>
  );
}

export function PortalPreview({ area, kitId, edit, requestId = "" }: { area: Area; kitId?: string; edit?: boolean; requestId?: string }) {
  const state = useSyncExternalStore(subscribe, getPreview, getSeed);
  const drawer = useRef<HTMLDialogElement>(null);
  const isAdmin = area === "peer-advisers" || area === "assignments" || area === "kit-drafts";

  const menu = (mobile = false) => <>
    <Link className={styles.wordmark} href="/portal" onClick={mobile ? () => drawer.current?.close() : undefined}>Peer Adviser<br />Portal</Link>
    <nav className={styles.sideNav} aria-label="Portal">
      <Link href="/dashboard"><Icon name="profile" />Profile</Link>
      {navigation.map((item) => (
        <Link key={item.area} href={item.href} aria-current={area === item.area ? "page" : undefined} onClick={mobile ? () => drawer.current?.close() : undefined}>
          <Icon name={item.area} />{item.label}
        </Link>
      ))}
    </nav>
    <nav className={styles.adminNav} aria-label="Administrator preview">
      <p>Administrator preview</p>
      {administration.map((item) => <Link key={item.area} href={item.href} aria-current={area === item.area ? "page" : undefined} onClick={mobile ? () => drawer.current?.close() : undefined}>{item.label}</Link>)}
      <Link href="/admin">Abuse Reports</Link>
    </nav>
  </>;

  return (
    <div className={styles.portal}>
      <a className="skipLink" href="#portal-main">Skip to content</a>
      <aside className={styles.sidebar}>{menu()}<MapuaSquares className={styles.sidePattern} /></aside>
      <header className={styles.mobileHeader}>
        <button type="button" aria-label="Open Portal navigation" onClick={() => drawer.current?.showModal()}><Icon name="menu" /></button>
        <Link href="/portal">Peer Adviser Portal</Link>
        <Link href="/dashboard" aria-label="Profile"><Icon name="profile" /></Link>
      </header>
      <dialog className={styles.drawer} ref={drawer} aria-label="Portal navigation">
        <button className={styles.close} type="button" aria-label="Close Portal navigation" onClick={() => drawer.current?.close()}>×</button>
        {menu(true)}
      </dialog>
      <main id="portal-main" className={styles.workspace}>
        <p className={styles.previewNotice}>Local preview · {isAdmin ? "Administrator" : "Peer Adviser"} · Fictional data. Changes stay in this tab.</p>
        <MapuaSquares className={styles.workspacePattern} />
        {area === "home" && <PreviewHome state={state} />}
        {(area === "scheduler" || area === "assignments") && <Scheduler state={state} administrator={isAdmin} requestId={requestId} />}
        {area === "kits" && <TeachingKits state={state} kitId={kitId} edit={edit} />}
        {area === "directory" && <Directory state={state} />}
        {area === "me" && <Settings adviser={state.advisers.find((adviser) => adviser.id === peerId)} />}
        {area === "peer-advisers" && <PeerAdviserApprovals state={state} />}
        {area === "kit-drafts" && <KitReviews drafts={state.drafts} />}
      </main>
      <nav className={styles.bottomNav} aria-label="Portal shortcuts">
        {navigation.map((item) => <Link href={item.href} key={item.area} aria-current={area === item.area ? "page" : undefined}><Icon name={item.area} />{item.mobile}</Link>)}
      </nav>
    </div>
  );
}
