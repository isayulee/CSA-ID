"use client";

import { useSyncExternalStore } from "react";
import { PortalShell } from "./portal-shell";
import { PeerAdviserApprovals, type ApprovalAction } from "./peer-adviser-approvals";
import { KitReviews } from "./teaching-kits";
import { campuses, candidates, getPreview, getSeed, subscribe, updatePreview } from "./model";

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
      }));
      return `Revoked approval for ${person.name}.`;
  }
}

export function AdminPortalPreview({ area }: { area: "peer-advisers" | "kit-drafts" }) {
  const state = useSyncExternalStore(subscribe, getPreview, getSeed);
  return (
    <PortalShell area={area} preview>
      {area === "peer-advisers" && <PeerAdviserApprovals
        advisers={state.advisers}
        candidates={candidates.filter((person) => !state.advisers.some(({ id }) => id === person.id))}
        campuses={campuses.map((name) => ({ id: name, name }))}
        onAction={runPreviewApproval}
      />}
      {area === "kit-drafts" && <KitReviews drafts={state.drafts} approvedKits={state.kits} />}
    </PortalShell>
  );
}
