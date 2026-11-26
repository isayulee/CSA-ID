"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { PortalShell } from "./portal-shell";
import { Settings, Directory } from "./people";
import { PeerAdviserApprovals, type ApprovalAction } from "./peer-adviser-approvals";
import { Scheduler } from "./scheduler";
import { TeachingKits, KitReviews } from "./teaching-kits";
import { academicTerm, campuses, candidates, getPreview, getSeed, peerId, statuses, subscribe, updatePreview, type PreviewState } from "./model";
import styles from "./portal.module.css";

type Area = "home" | "kits" | "scheduler" | "directory" | "me" | "peer-advisers" | "kit-drafts" | "assignments";

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

function runPreviewApproval(action: ApprovalAction) {
  const person = [...getPreview().advisers, ...candidates].find(({ id }) => id === action.userId);
  if (!person) throw new Error("User not found");
  switch (action.type) {
    case "approve":
      updatePreview((state) => ({
        ...state, advisers: [...state.advisers, {
          ...person, campus: action.campusId, courses: [], slots: [], position: "", order: 0,
        }],
      }));
      return `Approved ${person.name} as a Peer Adviser.`;
    case "update":
      updatePreview((state) => ({
        ...state,
        advisers: state.advisers.map((adviser) => adviser.id === action.userId
          ? { ...adviser, campus: action.campusId, position: action.position, order: action.order }
          : adviser),
      }));
      return `Saved changes for ${person.name}.`;
    case "revoke":
      updatePreview((state) => ({
        ...state,
        advisers: state.advisers.filter(({ id }) => id !== action.userId),
        requests: state.requests.map((request) => request.claimant === action.userId &&
          (request.status === "pending" || request.status === "rescheduled")
          ? { ...request, claimant: "" } : request),
      }));
      return `Revoked approval for ${person.name}.`;
  }
}

export function PortalPreview({ area, kitId, edit, requestId = "" }: { area: Area; kitId?: string; edit?: boolean; requestId?: string }) {
  const state = useSyncExternalStore(subscribe, getPreview, getSeed);
  const isAdmin = area === "assignments";

  return (
    <PortalShell area={area} preview>
      {area === "home" && <PreviewHome state={state} />}
      {(area === "scheduler" || area === "assignments") && <Scheduler key={requestId} state={state} administrator={isAdmin} requestId={requestId} />}
      {area === "kits" && <TeachingKits state={state} kitId={kitId} edit={edit} />}
      {area === "directory" && <Directory state={state} />}
      {area === "me" && <Settings adviser={state.advisers.find((adviser) => adviser.id === peerId)} />}
      {area === "peer-advisers" && <PeerAdviserApprovals
        advisers={state.advisers}
        candidates={candidates.filter((person) => !state.advisers.some(({ id }) => id === person.id))}
        campuses={campuses.map((name) => ({ id: name, name }))}
        onAction={runPreviewApproval}
      />}
      {area === "kit-drafts" && <KitReviews drafts={state.drafts} />}
    </PortalShell>
  );
}
