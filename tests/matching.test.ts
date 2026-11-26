import { describe, expect, it } from "vitest";
import { rankPeerAdvisers, type MatchingPeerAdviser, type MatchingRequest } from "@/lib/matching";

const request: MatchingRequest = {
  courseCode: "MATH146",
  campusId: "intramuros",
  timesUnclear: false,
  slots: [{ weekday: 1, onDate: "", hour: 9 }],
};

function peerAdviser(userId: string, overrides: Partial<MatchingPeerAdviser> = {}): MatchingPeerAdviser {
  return {
    userId,
    campusId: "intramuros",
    courseCodes: ["MATH146"],
    availability: [{ weekday: 1, hour: 9 }],
    openRequestCount: 0,
    ...overrides,
  };
}

function rankedIds(result: ReturnType<typeof rankPeerAdvisers>) {
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
    const busyMonday: MatchingRequest = {
      ...request,
      slots: [
        { weekday: 1, onDate: "", hour: 9 },
        { weekday: 1, onDate: "", hour: 10 },
        { weekday: 3, onDate: "", hour: 14 },
      ],
    };

    const result = rankPeerAdvisers(busyMonday, [
      peerAdviser("one-hour", { availability: [{ weekday: 3, hour: 14 }] }),
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
      peerAdviser("two-hours", {
        availability: [
          { weekday: 1, hour: 10 },
          { weekday: 3, hour: 14 },
        ],
      }),
    ]);

    expect(result).toEqual({
      ok: true,
      suggestions: [
        { userId: "all-three", matchingSlots: 3, openRequestCount: 0 },
        { userId: "two-hours", matchingSlots: 2, openRequestCount: 0 },
        { userId: "one-hour", matchingSlots: 1, openRequestCount: 0 },
        { userId: "no-overlap", matchingSlots: 0, openRequestCount: 0 },
        { userId: "same-hour-other-day", matchingSlots: 0, openRequestCount: 0 },
      ],
    });
  });

  it("scores a dated slot by the weekday of its date", () => {
    // 2026-12-02 is a Wednesday.
    const datedRequest: MatchingRequest = { ...request, slots: [{ weekday: 3, onDate: "2026-12-02", hour: 13 }] };

    const result = rankPeerAdvisers(datedRequest, [
      peerAdviser("monday", { availability: [{ weekday: 1, hour: 13 }] }),
      peerAdviser("wednesday", { availability: [{ weekday: 3, hour: 13 }] }),
    ]);

    expect(rankedIds(result)).toEqual(["wednesday", "monday"]);
  });

  it("counts each slot, so an hour offered on two dates counts twice", () => {
    // 2026-12-07 and 2026-12-14 are Mondays.
    const twoMondays: MatchingRequest = {
      ...request,
      slots: [
        { weekday: 1, onDate: "2026-12-07", hour: 9 },
        { weekday: 1, onDate: "2026-12-14", hour: 9 },
      ],
    };

    expect(rankPeerAdvisers(twoMondays, [peerAdviser("monday-nine")])).toEqual({
      ok: true,
      suggestions: [{ userId: "monday-nine", matchingSlots: 2, openRequestCount: 0 }],
    });
  });

  it("breaks a tie in overlapping hours by the fewest open requests", () => {
    const result = rankPeerAdvisers(request, [
      peerAdviser("three-open", { openRequestCount: 3 }),
      peerAdviser("no-overlap-idle", { availability: [], openRequestCount: 0 }),
      peerAdviser("one-open", { openRequestCount: 1 }),
    ]);

    expect(rankedIds(result)).toEqual(["one-open", "three-open", "no-overlap-idle"]);
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

    it("when the advisee's times are unclear, even if slots exist", () => {
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
