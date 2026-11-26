/** 1 is Monday and 6 is Saturday. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6;
/** 8 is the hour from 08:00 to 09:00, and 16 is the hour from 16:00 to 17:00. */
export type Hour = 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16;

export type HourSlot = { weekday: Weekday; hour: Hour };

export type AdvisingRequestForMatching = {
  courseCode: string | null;
  campusId: string | null;
  timesUnclear: boolean;
  /** A dated slot carries the weekday of its date. */
  slots: readonly HourSlot[];
};

export type PeerAdviserForMatching = {
  userId: string;
  campusId: string;
  courseCodes: readonly string[];
  availability: readonly HourSlot[];
  claimedPendingOrRescheduledCount: number;
};

export type Suggestion = { userId: string; matchingSlots: number; claimedPendingOrRescheduledCount: number };

export type NoSuggestionReason = "course_missing" | "campus_missing" | "times_unclear";

export type MatchingResult =
  | { ok: true; suggestions: Suggestion[] }
  | { ok: false; reasons: NoSuggestionReason[] };

const slotKey = ({ weekday, hour }: HourSlot) => weekday * 100 + hour;

export function rankPeerAdvisers(
  request: AdvisingRequestForMatching,
  peerAdvisers: readonly PeerAdviserForMatching[],
): MatchingResult {
  const { courseCode, campusId } = request;
  if (courseCode === null || campusId === null || request.timesUnclear) {
    const reasons: NoSuggestionReason[] = [];
    if (courseCode === null) reasons.push("course_missing");
    if (campusId === null) reasons.push("campus_missing");
    if (request.timesUnclear) reasons.push("times_unclear");
    return { ok: false, reasons };
  }

  const requestSlotKeys = request.slots.map(slotKey);
  const suggestions = peerAdvisers
    .filter((peerAdviser) => peerAdviser.campusId === campusId && peerAdviser.courseCodes.includes(courseCode))
    .map((peerAdviser) => {
      const free = new Set(peerAdviser.availability.map(slotKey));
      return {
        userId: peerAdviser.userId,
        matchingSlots: requestSlotKeys.filter((key) => free.has(key)).length,
        claimedPendingOrRescheduledCount: peerAdviser.claimedPendingOrRescheduledCount,
      };
    })
    .sort(
      (a, b) =>
        b.matchingSlots - a.matchingSlots ||
        a.claimedPendingOrRescheduledCount - b.claimedPendingOrRescheduledCount ||
        a.userId.localeCompare(b.userId),
    );
  return { ok: true, suggestions };
}
