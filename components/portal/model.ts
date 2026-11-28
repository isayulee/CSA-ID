export const campuses = ["Intramuros", "Makati"];
export type Course = { code: string; title: string };
export const courses: Course[] = [
  { code: "CS210", title: "Data Structures" },
  { code: "PHYS141", title: "Classical Mechanics" },
  { code: "CHEM241", title: "Organic Chemistry" },
  { code: "MATH215", title: "Linear Algebra" },
  { code: "MATH146", title: "Calculus" },
];
export const statuses = {
  pending: "Pending",
  rescheduled: "Rescheduled",
  done: "Done",
  cancelled: "Cancelled",
  no_peer_adviser_available: "No Peer Adviser Available",
  no_response_from_advisee: "No Response from Advisee",
} as const;
type RequestStatus = keyof typeof statuses;
export const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const hours = Array.from({ length: 9 }, (_, i) => i + 8);

export type Adviser = { id: string; name: string; campus: string; position: string; order: number; courses: string[]; slots: string[] };
export type AdvisingRequest = {
  id: string; course: string; campus: string; topic: string; status: RequestStatus;
  sheet: "schedule" | "plan-ahead";
  claimant: string; date: string; time: string; slots: string[];
  advisee: string; email: string; notes: string[];
};
export type Kit = { id: string; course: string; year: number; term: number; title: string; body: string; link: string; pdf: string; revision?: string };
export type KitDraft = Kit & { author: string; base: string; state: "pending" | "approved" | "rejected"; note: string };
export type PreviewState = { addedCourses?: Course[]; advisers: Adviser[]; requests: AdvisingRequest[]; kits: Kit[]; drafts: KitDraft[] };
export const peerId = "alex";
export const candidates = [{ id: "sam", name: "Sam Rivera" }, { id: "mika", name: "Mika Tan" }];
const sampleDay = "2026-11-25";

const seed: PreviewState = {
  advisers: [
    { id: peerId, name: "Alex Santos", campus: "Intramuros", position: "", order: 0, courses: ["CS210", "MATH215"], slots: ["0-10", "2-14", "3-14"] },
    { id: "ren", name: "Ren Mendoza", campus: "Intramuros", position: "Coordinator", order: 1, courses: ["CS210", "CHEM241"], slots: ["0-10", "3-14", "3-15"] },
    { id: "toni", name: "Toni Cruz", campus: "Makati", position: "", order: 0, courses: ["PHYS141", "MATH146"], slots: ["1-13"] },
  ],
  requests: [
    { id: "search-trees", sheet: "schedule", course: "CS210", campus: "Intramuros", topic: "Binary search trees and AVL balancing", status: "pending", claimant: peerId, date: sampleDay, time: "14:00", slots: ["2-14"], advisee: "Avery Reyes", email: "avery@example.test", notes: [] },
    { id: "graphs", sheet: "plan-ahead", course: "CS210", campus: "Intramuros", topic: "Graph traversal and shortest paths", status: "pending", claimant: "", date: "", time: "", slots: ["3-14", "3-15"], advisee: "Casey Ramos", email: "casey@example.test", notes: [] },
    { id: "rotations", sheet: "schedule", course: "PHYS141", campus: "Makati", topic: "Rotational dynamics and torque", status: "rescheduled", claimant: "toni", date: "2026-11-27", time: "13:00", slots: ["1-13"], advisee: "Dani Lim", email: "dani@example.test", notes: ["Review the practice set first."] },
    { id: "reactions", sheet: "plan-ahead", course: "CHEM241", campus: "Intramuros", topic: "Reaction mechanisms and synthesis", status: "pending", claimant: "", date: "", time: "", slots: [], advisee: "Jules Yu", email: "jules@example.test", notes: [] },
  ],
  kits: [
    { id: "cs", course: "CS210", year: 2026, term: 1, title: "Binary Search Trees & AVL Balancing", body: "Draw the tree after inserting each key. Then identify the first unbalanced node and explain which rotation restores balance.", link: "", pdf: "" },
    { id: "physics", course: "PHYS141", year: 2026, term: 1, title: "Classical Mechanics Problem Set", body: "Work through torque, moment of inertia, and angular momentum.", link: "", pdf: "" },
    { id: "organic", course: "CHEM241", year: 2026, term: 1, title: "Organic Chemistry Reaction Mechanisms", body: "Compare substitution and elimination reactions using worked examples.", link: "", pdf: "" },
    { id: "linear", course: "MATH215", year: 2026, term: 1, title: "Vector Spaces & Orthogonal Projections", body: "Build an orthonormal basis and project a vector onto the resulting subspace.", link: "", pdf: "" },
  ],
  drafts: [],
};

const storageKey = "csa-portal-preview-v1";
let cachedJson: string | null = null;
let cachedState = seed;
const listeners = new Set<() => void>();

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function getSeed() { return seed; }

function restorePreview(raw: string): PreviewState {
  const restored = JSON.parse(raw) as PreviewState;
  return {
    ...restored,
    requests: restored.requests.map((request) => request.sheet ? request : {
      ...request,
      sheet: seed.requests.find((sample) => sample.id === request.id)?.sheet ?? "plan-ahead",
    }),
  };
}

export function getPreview() {
  try {
    const raw = sessionStorage.getItem(storageKey);
    if (raw !== cachedJson) {
      cachedState = raw ? restorePreview(raw) : seed;
      cachedJson = raw;
    }
  } catch {
    // The in-memory preview also works with storage disabled.
  }
  return cachedState;
}
export function updatePreview(update: (state: PreviewState) => PreviewState) {
  cachedState = update(getPreview());
  cachedJson = JSON.stringify(cachedState);
  try { sessionStorage.setItem(storageKey, cachedJson); } catch { /* keep the current tab state */ }
  listeners.forEach((listener) => listener());
}

export function academicTerm(year: number, term: number) {
  return `Term ${term} · AY ${year}–${year + 1}`;
}
