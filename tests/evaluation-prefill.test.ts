import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EvaluationPrefill, getSessionDate } from "@/components/evaluation-prefill";

describe("CSA evaluation prefill", () => {
  it("renders the Manila session date before JavaScript loads", () => {
    const html = renderToStaticMarkup(createElement(EvaluationPrefill, { adviserName: "Santos, Alex", studentNumber: null }));
    expect(html).toContain('name="entry.1373085080" value=');
    expect(html).not.toContain('name="entry.1373085080"/>');
  });

  it("omits the student number field when no number was supplied", () => {
    const html = renderToStaticMarkup(createElement(EvaluationPrefill, { adviserName: "Santos, Alex", studentNumber: null }));
    expect(html).not.toContain("0012345678");
    expect(html).not.toContain("entry.2119958442");
  });

  it("includes the supplied student number in the prefill form", () => {
    const html = renderToStaticMarkup(createElement(EvaluationPrefill, { adviserName: "Santos, Alex", studentNumber: "0012345678" }));
    expect(html).toContain('name="entry.2119958442" value="0012345678"');
  });

  it("formats the session date in Asia/Manila", () => {
    expect(getSessionDate(new Date("2026-11-19T16:30:00Z"))).toBe("2026-11-20");
  });
});
