import { SocialIcon } from "@/components/social-icon";
import { evaluationFormAction } from "@/lib/evaluation-form";

const sessionDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Manila",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function getSessionDate(date = new Date()) {
  const parts = sessionDate.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return `${year}-${month}-${day}`;
}

export function EvaluationPrefill({ adviserName, studentNumber }: { adviserName: string; studentNumber: string | null }) {
  return (
    <form
      className="evaluationPrefill"
      action={evaluationFormAction}
      method="get"
      target="_blank"
      rel="noreferrer"
    >
      <input type="hidden" name="usp" value="pp_url" />
      <input type="hidden" name="entry.1373085080" value={getSessionDate()} />
      <input type="hidden" name="entry.867817569" value={adviserName} />
      {studentNumber && <input type="hidden" name="entry.2119958442" value={studentNumber} />}
      <button className="evaluationButton" type="submit">
        Open session evaluation <span className="srOnly"> (opens in a new tab)</span><SocialIcon className="buttonExternalIcon" platform="external" />
      </button>
    </form>
  );
}
