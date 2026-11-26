"use client";

import { useRef, useState } from "react";
import type { OpenReport } from "@/lib/admin";

const REASON_LABELS: Record<string, string> = {
  "impersonation": "Impersonation",
  "malicious-link": "Malicious link",
  "prohibited-content": "Prohibited content",
};

type Action = "suspend" | "remove-images";

const reportDateTime = new Intl.DateTimeFormat("en-PH", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Manila",
});

function ReportRow({ report }: { report: OpenReport }) {
  const createdAt = new Date(report.createdAt * 1000);
  const resultRef = useRef<HTMLParagraphElement>(null);
  const [activeAction, setActiveAction] = useState<Action | null>(null);
  const [reason, setReason] = useState("");
  const busy = activeAction !== null;
  const [notice, setNotice] = useState("");
  const [status, setStatus] = useState(report.profileStatus);

  async function run(action: Action) {
    setActiveAction(action);
    resultRef.current?.focus();
    setNotice(action === "suspend" ? "Suspending…" : "Removing images…");
    try {
      const response = await fetch(`/api/admin/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ profileId: report.profileId, reason }) });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) return setNotice(result.error || "That didn't work. Try again");
      if (action === "suspend") setStatus("suspended");
      setNotice(action === "suspend" ? "Profile suspended" : "Images removed");
      setReason("");
    } catch {
      setNotice("That didn't work. Check your connection and try again");
    } finally {
      setActiveAction(null);
    }
  }

  const canAct = Boolean(report.profileId) && reason.trim().length > 0 && !busy;
  return (
    <li className="adminReport">
      <div className="adminReportHead">
        <strong>{REASON_LABELS[report.reason] ?? report.reason}</strong>
        <time dateTime={createdAt.toISOString()}>{reportDateTime.format(createdAt)}</time>
      </div>
      <p className="adminReportProfile">
        {report.profileId
          ? <>{report.displayName} · {report.slug ? <a href={`/id/${report.slug}`} target="_blank" rel="noreferrer">/id/{report.slug}</a> : "no address yet"} · <span className="statusBadge">{status}</span></>
          : "This Profile's account was deleted."}
      </p>
      <p className="adminReportDetails">{report.details}</p>
      {report.profileId && (
        <div className="adminReportActions">
          <label className="field">Reason for the audit log
            <input value={reason} maxLength={1000} onChange={(event) => setReason(event.target.value)} />
          </label>
          <div className="buttonRow">
            <button className="button buttonSmall" type="button" disabled={!canAct || status === "suspended"} aria-label={`Suspend Profile for ${report.displayName ?? "this User"}`} onClick={() => run("suspend")}>{activeAction === "suspend" ? "Suspending…" : "Suspend Profile"}</button>
            <button className="buttonSecondary buttonSmall" type="button" disabled={!canAct} aria-label={`Remove images for ${report.displayName ?? "this User"}`} onClick={() => run("remove-images")}>{activeAction === "remove-images" ? "Removing images…" : "Remove images"}</button>
          </div>
          <p className="formStatus" role="status" ref={resultRef} tabIndex={-1}>{notice}</p>
        </div>
      )}
    </li>
  );
}

export function AdminReports({ reports }: { reports: OpenReport[] }) {
  if (reports.length === 0) return <p>No open Abuse Reports.</p>;
  return <ul className="adminReportList">{reports.map((report) => <ReportRow key={report.id} report={report} />)}</ul>;
}
