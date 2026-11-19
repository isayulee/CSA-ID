"use client";

import { useRef } from "react";
import { SocialIcon } from "@/components/social-icon";
import { evaluationFormAction } from "@/lib/evaluation-form";

const sessionDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Manila",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function EvaluationPrefill({ adviserName, studentNumber }: { adviserName: string; studentNumber: string | null }) {
  const dateInput = useRef<HTMLInputElement>(null);

  return (
    <form
      className="evaluationPrefill"
      action={evaluationFormAction}
      method="get"
      target="_blank"
      rel="noreferrer"
      onSubmit={() => {
        const parts = sessionDate.formatToParts(new Date());
        const year = parts.find((part) => part.type === "year")?.value;
        const month = parts.find((part) => part.type === "month")?.value;
        const day = parts.find((part) => part.type === "day")?.value;
        if (dateInput.current) dateInput.current.value = `${year}-${month}-${day}`;
      }}
    >
      <input type="hidden" name="usp" value="pp_url" />
      <input type="hidden" name="entry.1373085080" ref={dateInput} />
      <input type="hidden" name="entry.867817569" value={adviserName} />
      {studentNumber && <input type="hidden" name="entry.2119958442" value={studentNumber} />}
      <button className="evaluationButton" type="submit">
        Open session evaluation <SocialIcon className="buttonExternalIcon" platform="external" />
      </button>
    </form>
  );
}
