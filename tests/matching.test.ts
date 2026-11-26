import { describe, expect, it } from "vitest";
import {
  rankPeerAdvisers,
  type AdvisingRequestForMatching,
  type MatchingResult,
  type PeerAdviserForMatching,
} from "@/lib/matching";

const request: AdvisingRequestForMatching = {
  courseCode: "MATH146",
  campusId: "intramuros",
  timesUnclear: false,
  slots: [{ weekday: 1, hour: 9 }],
};

function peerAdviser(userId: string, overrides: Partial<PeerAdviserForMatching> = {}): PeerAdviserForMatching {
  return {
    userId,
    campusId: "intramuros",
    courseCodes: ["MATH146"],
    availability: [{ weekday: 1, hour: 9 }],
    claimedPendingOrRescheduledCount: 0,
    ...overrides,
  };
}

function rankedIds(result: MatchingResult) {
  if (!result.ok) throw new Error(`expected suggestions, got ${result.reasons.join(", ")}`);
  return result.suggestions.map((suggestion) => suggestion.userId);
}

describe("rankPeerAdvisers", () => {
  it("keeps only Peer Advisers who tutor the Course on the request's Campus", () => {
    const result = rankPeerAdvisers(request, [
      peerAdviser("match"),
      peerAdviser("other-course", { courseCodes: ["CHM11-3L"] }),
      peerAdviser("other-campus", { campusId: "makati" }),
      peerAdviser("tutors-several", { courseCodes: ["CHM11-3L", "MATH146"] }),
    ]);

    expect(rankedIds(result).sort()).toEqual(["match", "tutors-several"]);
  });

  it("ranks by how many of the request's slots fall in each Peer Adviser's Availability", () => {
    const threeSlots: AdvisingRequestForMatching = {
      ...request,
      slots: [
        { weekday: 1, hour: 9 },
        { weekday: 1, hour: 10 },
        { weekday: 3, hour: 14 },
      ],
    };

    const result = rankPeerAdvisers(threeSlots, [
      peerAdviser("one-slot", { availability: [{ weekday: 3, hour: 14 }] }),
      peerAdviser("no-overlap", { availability: [{ weekday: 2, hour: 9 }] }),
      peerAdviser("all-three", {
        availability: [
          { weekday: 1, hour: 9 },
          { weekday: 1, hour: 10 },
          { weekday: 3, hour: 14 },
          { weekday: 6, hour: 8 },
        ],
      }),
      peerAdviser("same-hour-other-day", { availability: [{ weekday: 2, hour: 10 }] }),
      peerAdviser("two-slots", {
        availability: [
          { weekday: 1, hour: 10 },
          { weekday: 3, hour: 14 },
        ],
      }),
    ]);

    expect(result).toEqual({
      ok: true,
      suggestions: [
        { userId: "all-three", matchingSlots: 3, claimedPendingOrRescheduledCount: 0 },
        { userId: "two-slots", matchingSlots: 2, claimedPendingOrRescheduledCount: 0 },
        { userId: "one-slot", matchingSlots: 1, claimedPendingOrRescheduledCount: 0 },
        { userId: "no-overlap", matchingSlots: 0, claimedPendingOrRescheduledCount: 0 },
        { userId: "same-hour-other-day", matchingSlots: 0, claimedPendingOrRescheduledCount: 0 },
      ],
    });
  });

  it("counts an hour twice when the Advisee offers it on two dates", () => {
    const twoMondays: AdvisingRequestForMatching = {
      ...request,
      slots: [
        { weekday: 1, hour: 9 },
        { weekday: 1, hour: 9 },
      ],
    };

    expect(rankPeerAdvisers(twoMondays, [peerAdviser("monday-nine")])).toEqual({
      ok: true,
      suggestions: [{ userId: "monday-nine", matchingSlots: 2, claimedPendingOrRescheduledCount: 0 }],
    });
  });

  it("breaks a tie in matching slots by fewer claimed pending or rescheduled requests", () => {
    const result = rankPeerAdvisers(request, [
      peerAdviser("busy", { claimedPendingOrRescheduledCount: 3 }),
      peerAdviser("free-elsewhere", { availability: [], claimedPendingOrRescheduledCount: 0 }),
      peerAdviser("quiet", { claimedPendingOrRescheduledCount: 1 }),
    ]);

    expect(rankedIds(result)).toEqual(["quiet", "busy", "free-elsewhere"]);
  });

  it("returns the same order whatever order the Peer Advisers arrive in", () => {
    const tied = [peerAdviser("user-b"), peerAdviser("user-c"), peerAdviser("user-a")];

    expect(rankedIds(rankPeerAdvisers(request, tied))).toEqual(["user-a", "user-b", "user-c"]);
    expect(rankedIds(rankPeerAdvisers(request, [...tied].reverse()))).toEqual(["user-a", "user-b", "user-c"]);
  });

  describe("returns no suggestions, and says why", () => {
    const everyone = [peerAdviser("match")];

    it("when the request has no Course yet", () => {
      expect(rankPeerAdvisers({ ...request, courseCode: null }, everyone)).toEqual({
        ok: false,
        reasons: ["course_missing"],
      });
    });

    it("when the request has no Campus yet", () => {
      expect(rankPeerAdvisers({ ...request, campusId: null }, everyone)).toEqual({
        ok: false,
        reasons: ["campus_missing"],
      });
    });

    it("when the Advisee's times are unclear, even if slots exist", () => {
      expect(rankPeerAdvisers({ ...request, timesUnclear: true }, everyone)).toEqual({
        ok: false,
        reasons: ["times_unclear"],
      });
    });

    it("naming every missing piece at once", () => {
      const result = rankPeerAdvisers({ courseCode: null, campusId: null, timesUnclear: true, slots: [] }, everyone);

      expect(result).toEqual({ ok: false, reasons: ["course_missing", "campus_missing", "times_unclear"] });
    });
  });

  it("returns an empty ranking when nobody tutors the Course on that Campus", () => {
    expect(rankPeerAdvisers(request, [peerAdviser("elsewhere", { campusId: "makati" })])).toEqual({
      ok: true,
      suggestions: [],
    });
  });
});
