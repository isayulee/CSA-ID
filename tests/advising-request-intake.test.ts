import { describe, expect, it } from "vitest";
import { parseScheduledDate, statusFromRemarks } from "@/lib/advising-request-intake";

// Add anonymized Remarks from the intake Sheet as rows here.
const remarksExamples = [
  { remarks: "", status: "pending" },
  { remarks: "Pending", status: "pending" },
  { remarks: "DONE", status: "done" },
  { remarks: "done - 2 hrs", status: "done" },
  { remarks: "Rescheduled", status: "rescheduled" },
  { remarks: "Rescheduled to Friday, then done", status: "rescheduled" },
  { remarks: "Cancelled", status: "cancelled" },
  { remarks: "canceled by advisee", status: "cancelled" },
  { remarks: "No Peer Adviser available", status: "no_peer_adviser_available" },
  { remarks: "no peer advisor available this week", status: "no_peer_adviser_available" },
  { remarks: "No response from advisee", status: "no_response_from_advisee" },
  { remarks: "no response from the advisee, cancelled", status: "no_response_from_advisee" },
  { remarks: "Abandoned", status: "pending" },
  { remarks: "undone", status: "pending" },
  { remarks: "not done yet", status: "pending" },
] as const;

describe("statusFromRemarks", () => {
  it.each(remarksExamples)("reads $remarks as $status", ({ remarks, status }) => {
    expect(statusFromRemarks(remarks)).toBe(status);
  });
});

const dateExamples = [
  { text: "27-Aug-25", date: "2025-08-27" },
  { text: "3-Sep-2025", date: "2025-09-03" },
  { text: " 03-sep-25 ", date: "2025-09-03" },
  { text: "2025-08-27", date: "2025-08-27" },
  { text: "31-Feb-25", date: null },
  { text: "Aug 27", date: null },
  { text: "TBA", date: null },
  { text: "", date: null },
] as const;

describe("parseScheduledDate", () => {
  it.each(dateExamples)("reads $text as $date", ({ text, date }) => {
    expect(parseScheduledDate(text)).toBe(date);
  });
});
