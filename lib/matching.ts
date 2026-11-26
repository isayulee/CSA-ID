/** Weekday 1 = Monday ... 6 = Saturday; hour 8 = 08:00-09:00 ... 16 = 16:00-17:00 (section 14.3). */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6;
export type Hour = 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16;

export type MatchingRequest = {
  courseCode: string | null;
  campusId: string | null;
  timesUnclear: boolean;
  /** A dated slot keeps its date's weekday; a weekly slot has onDate "". */
  slots: readonly { weekday: Weekday; onDate: string; hour: Hour }[];
};

export type MatchingPeerAdviser = {
  userId: string;
  campusId: string;
  courseCodes: readonly string[];
  availability: readonly { weekday: Weekday; hour: Hour }[];
  /** Requests they claimed whose status is pending or rescheduled. */
  openRequestCount: number;
};

export type Suggestion = { userId: string; matchingSlots: number; openRequestCount: number };

export type MatchingResult =
  | { ok: true; suggestions: Suggestion[] }
  | { ok: false; reasons: NoSuggestionReason[] };

export type NoSuggestionReason = "course_missing" | "campus_missing" | "times_unclear";

/** Ranks Peer Advisers for an unclaimed Advising Request (section 14.6). Never assigns and stores nothing. */
export function rankPeerAdvisers(
  request: MatchingRequest,
  peerAdvisers: readonly MatchingPeerAdviser[],
): MatchingResult {
  const { courseCode, campusId } = request;
  if (courseCode === null || campusId === null || request.timesUnclear) {
    const reasons: NoSuggestionReason[] = [];
    if (courseCode === null) reasons.push("course_missing");
    if (campusId === null) reasons.push("campus_missing");
    if (request.timesUnclear) reasons.push("times_unclear");
    return { ok: false, reasons };
  }

  const suggestions = peerAdvisers
    .filter((peerAdviser) => peerAdviser.campusId === campusId && peerAdviser.courseCodes.includes(courseCode))
    .map((peerAdviser) => {
      const free = new Set(peerAdviser.availability.map(({ weekday, hour }) => weekday * 100 + hour));
      return {
        userId: peerAdviser.userId,
        matchingSlots: request.slots.filter(({ weekday, hour }) => free.has(weekday * 100 + hour)).length,
        openRequestCount: peerAdviser.openRequestCount,
      };
    })
    .sort(
      (a, b) =>
        b.matchingSlots - a.matchingSlots ||
        a.openRequestCount - b.openRequestCount ||
        (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0),
    );
  return { ok: true, suggestions };
}
