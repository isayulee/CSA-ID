import { describe, expect, it } from "vitest";
import { parseAvailableTimes, parseCourseCode, type AdvisingRequestSlot } from "@/lib/advising-request-parsing";
import type { Hour } from "@/lib/advising-slots";

const knownCourseCodes = new Set(["MATH146", "CHM11-3", "CHM11-3L", "PHY10", "COE60-L"]);

// Add anonymized course answers from the intake Sheet as rows here.
const courseExamples: { courseText: string; courseCode: string | null }[] = [
  { courseText: "Calculus 1/MATH146", courseCode: "MATH146" },
  { courseText: "MATH146", courseCode: "MATH146" },
  { courseText: "math 146", courseCode: "MATH146" },
  { courseText: "Math146 - Calculus 1", courseCode: "MATH146" },
  { courseText: "CHM11-3L", courseCode: "CHM11-3L" },
  { courseText: "chm11-3l (laboratory)", courseCode: "CHM11-3L" },
  { courseText: "General Chemistry CHM11-3", courseCode: "CHM11-3" },
  { courseText: "PHY10 or MATH146", courseCode: "PHY10" },
  { courseText: "MATH999 / MATH146", courseCode: "MATH146" },
  { courseText: "COE60-L", courseCode: "COE60-L" },
  { courseText: "Math146-Calculus", courseCode: "MATH146" },
  { courseText: "CHM11-3 Lab", courseCode: "CHM11-3L" },
  { courseText: "CHM11-3 laboratory", courseCode: "CHM11-3L" },
  { courseText: "Calculus 1", courseCode: null },
  { courseText: "MATH999", courseCode: null },
  { courseText: "", courseCode: null },
];

describe("parseCourseCode", () => {
  it.each(courseExamples)("reads $courseText as $courseCode", ({ courseText, courseCode }) => {
    expect(parseCourseCode(courseText, knownCourseCodes)).toBe(courseCode);
  });
});

type Day = Omit<AdvisingRequestSlot, "hour">;
const MON: Day = { weekday: 1, onDate: "" };
const TUE: Day = { weekday: 2, onDate: "" };
const WED: Day = { weekday: 3, onDate: "" };
const THU: Day = { weekday: 4, onDate: "" };
const FRI: Day = { weekday: 5, onDate: "" };
const SAT: Day = { weekday: 6, onDate: "" };
const WED_2025_08_27: Day = { weekday: 3, onDate: "2025-08-27" };
const SAT_2025_08_30: Day = { weekday: 6, onDate: "2025-08-30" };
const WED_2025_09_03: Day = { weekday: 3, onDate: "2025-09-03" };

// A Wednesday morning in Manila.
const SUBMITTED_AT = "2025-08-20T10:00:00+08:00";

type TimeExample = {
  dayText: string;
  timeText: string;
  submittedAt?: string;
  /** Every listed day at every listed hour, days in weekday-then-date order. */
  expected: { days: Day[]; hours: Hour[] } | "times unclear";
};

// Add anonymized day and time answers from the intake Sheet as rows here.
const timeExamples: TimeExample[] = [
  { dayText: "Monday", timeText: "1:00pm to 5:00pm", expected: { days: [MON], hours: [13, 14, 15, 16] } },
  { dayText: "Mon", timeText: "1:00 PM - 5:00 PM", expected: { days: [MON], hours: [13, 14, 15, 16] } },
  { dayText: "Tuesday, Thursday", timeText: "1:00pm to 5:00pm", expected: { days: [TUE, THU], hours: [13, 14, 15, 16] } },
  { dayText: "Tues and Thurs", timeText: "1:00pm to 5:00pm", expected: { days: [TUE, THU], hours: [13, 14, 15, 16] } },
  { dayText: "Sat", timeText: "8:00am to 12:00pm", expected: { days: [SAT], hours: [8, 9, 10, 11] } },
  { dayText: "MWF", timeText: "1:00pm to 5:00pm", expected: { days: [MON, WED, FRI], hours: [13, 14, 15, 16] } },
  { dayText: "TTh", timeText: "1:00pm to 5:00pm", expected: { days: [TUE, THU], hours: [13, 14, 15, 16] } },
  { dayText: "tth, sat", timeText: "1:00pm to 5:00pm", expected: { days: [TUE, THU, SAT], hours: [13, 14, 15, 16] } },
  { dayText: "T/Th", timeText: "1-5pm", expected: { days: [TUE, THU], hours: [13, 14, 15, 16] } },
  { dayText: "T, Th", timeText: "1-5pm", expected: { days: [TUE, THU], hours: [13, 14, 15, 16] } },
  { dayText: "Tu, Th", timeText: "1-5pm", expected: { days: [TUE, THU], hours: [13, 14, 15, 16] } },
  { dayText: "M, W, F", timeText: "1-5pm", expected: { days: [MON, WED, FRI], hours: [13, 14, 15, 16] } },
  { dayText: "M-Th", timeText: "1-5pm", expected: { days: [MON, TUE, WED, THU], hours: [13, 14, 15, 16] } },
  { dayText: "Th-F", timeText: "1-5pm", expected: { days: [THU, FRI], hours: [13, 14, 15, 16] } },
  { dayText: "every Monday only", timeText: "1-5pm", expected: { days: [MON], hours: [13, 14, 15, 16] } },
  // A word the parser can't read could change the meaning, so the whole answer is unclear.
  { dayText: "Wednesday, can't on other days", timeText: "1-5pm", expected: "times unclear" },
  { dayText: "Thursday 9 a.m. onwards", timeText: "9-11am", expected: "times unclear" },
  { dayText: "any day except Friday", timeText: "1-5pm", expected: "times unclear" },
  { dayText: "Mon-Sat except Wed", timeText: "1-5pm", expected: "times unclear" },
  { dayText: "not available on Tuesday", timeText: "1-5pm", expected: "times unclear" },
  { dayText: "Aug 27-29", timeText: "1-5pm", expected: "times unclear" },
  { dayText: "Monday, Friday", timeText: "Mon 1-3pm / Fri 9-11am", expected: "times unclear" },
  { dayText: "Monday", timeText: "1:00pm to 5:00pm (Philippine time)", expected: "times unclear" },
  { dayText: "Monday", timeText: "1-5pm only", expected: { days: [MON], hours: [13, 14, 15, 16] } },
  {
    dayText: "Mon-Fri",
    timeText: "1:00pm to 5:00pm",
    expected: { days: [MON, TUE, WED, THU, FRI], hours: [13, 14, 15, 16] },
  },
  {
    dayText: "Monday to Friday",
    timeText: "1:00pm to 5:00pm",
    expected: { days: [MON, TUE, WED, THU, FRI], hours: [13, 14, 15, 16] },
  },
  { dayText: "Wed – Sat", timeText: "1:00pm to 5:00pm", expected: { days: [WED, THU, FRI, SAT], hours: [13, 14, 15, 16] } },
  { dayText: "Mon", timeText: "1-5pm", expected: { days: [MON], hours: [13, 14, 15, 16] } },
  { dayText: "Mon", timeText: "13:00-17:00", expected: { days: [MON], hours: [13, 14, 15, 16] } },
  { dayText: "Mon", timeText: "1-5", expected: { days: [MON], hours: [13, 14, 15, 16] } },
  { dayText: "Mon", timeText: "11-1pm", expected: { days: [MON], hours: [11, 12] } },
  { dayText: "Mon", timeText: "10:00 AM - 12:00 NN", expected: { days: [MON], hours: [10, 11] } },
  { dayText: "Mon", timeText: "9:00am-11:00am, 1:00pm-3:00pm", expected: { days: [MON], hours: [9, 10, 13, 14] } },
  { dayText: "Mon", timeText: "9-11am and 2-4pm", expected: { days: [MON], hours: [9, 10, 14, 15] } },
  { dayText: "Mon", timeText: "10-12/1-3", expected: { days: [MON], hours: [10, 11, 13, 14] } },
  { dayText: "Mon", timeText: "8:30am to 10:15am", expected: { days: [MON], hours: [8, 9, 10] } },
  { dayText: "Mon", timeText: "7:00am to 6:00pm", expected: { days: [MON], hours: [8, 9, 10, 11, 12, 13, 14, 15, 16] } },
  { dayText: "Mon", timeText: "6pm-9pm", expected: "times unclear" },
  { dayText: "Mon", timeText: "8-10pm", expected: "times unclear" },
  { dayText: "Mon", timeText: "after 1pm", expected: "times unclear" },
  { dayText: "27-Aug-25", timeText: "1-5pm", expected: { days: [WED_2025_08_27], hours: [13, 14, 15, 16] } },
  { dayText: "27-Aug-2025", timeText: "1-5pm", expected: { days: [WED_2025_08_27], hours: [13, 14, 15, 16] } },
  { dayText: "Aug 27", timeText: "1-5pm", expected: { days: [WED_2025_08_27], hours: [13, 14, 15, 16] } },
  { dayText: "August 27th", timeText: "1-5pm", expected: { days: [WED_2025_08_27], hours: [13, 14, 15, 16] } },
  { dayText: "Sept 3, 2025", timeText: "1-5pm", expected: { days: [WED_2025_09_03], hours: [13, 14, 15, 16] } },
  // A date already given replaces its weekday, so "Wed" here is not every Wednesday.
  { dayText: "Wed, 27-Aug-25", timeText: "1-5pm", expected: { days: [WED_2025_08_27], hours: [13, 14, 15, 16] } },
  {
    dayText: "Aug 27 and Aug 30",
    timeText: "1-5pm",
    expected: { days: [WED_2025_08_27, SAT_2025_08_30], hours: [13, 14, 15, 16] },
  },
  // A date with no year falls within half a year on or after the day the form was submitted in Manila.
  { dayText: "Aug 18", timeText: "1-5pm", expected: "times unclear" },
  {
    dayText: "Jan 5",
    timeText: "1-5pm",
    submittedAt: "2025-12-20T10:00:00+08:00",
    expected: { days: [{ weekday: 1, onDate: "2026-01-05" }], hours: [13, 14, 15, 16] },
  },
  {
    dayText: "Aug 27",
    timeText: "1-5pm",
    submittedAt: "2025-08-27T15:30:00Z",
    expected: { days: [WED_2025_08_27], hours: [13, 14, 15, 16] },
  },
  {
    dayText: "Aug 27",
    timeText: "1-5pm",
    submittedAt: "2025-08-27T16:30:00Z",
    expected: "times unclear",
  },
  { dayText: "Sat, Sunday", timeText: "1-5pm", expected: { days: [SAT], hours: [13, 14, 15, 16] } },
  { dayText: "Sat-Sun", timeText: "1-5pm", expected: { days: [SAT], hours: [13, 14, 15, 16] } },
  { dayText: "Sunday", timeText: "1-5pm", expected: "times unclear" },
  { dayText: "Aug 31", timeText: "1-5pm", expected: "times unclear" },
  { dayText: "Fri, Mon, Monday", timeText: "1-3pm, 2-4pm", expected: { days: [MON, FRI], hours: [13, 14, 15] } },
  {
    dayText: "Aug 30, Sat, MWF",
    timeText: "1-5pm",
    expected: { days: [MON, WED, FRI, SAT_2025_08_30], hours: [13, 14, 15, 16] },
  },
  { dayText: "anytime", timeText: "1:00pm to 5:00pm", expected: "times unclear" },
  { dayText: "Monday", timeText: "anytime", expected: "times unclear" },
  { dayText: "", timeText: "", expected: "times unclear" },
];

describe("parseAvailableTimes", () => {
  const answers = ({ dayText, timeText, submittedAt }: TimeExample) => JSON.stringify({ dayText, timeText, submittedAt });

  it.each(timeExamples.map((example) => [answers(example), example] as const))(
    "reads %s",
    (_, { dayText, timeText, submittedAt = SUBMITTED_AT, expected }) => {
      const result = parseAvailableTimes({ dayText, timeText, submittedAt: new Date(submittedAt) });

      expect(result).toEqual(
        expected === "times unclear"
          ? { slots: [], timesUnclear: true }
          : {
              slots: expected.days.flatMap((day) => expected.hours.map((hour) => ({ ...day, hour }))),
              timesUnclear: false,
            },
      );
    },
  );
});
