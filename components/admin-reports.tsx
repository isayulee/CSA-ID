"use client";

import { useState } from "react";
import type { OpenReport } from "@/lib/admin";

const REASON_LABELS: Record<string, string> = {
  "impersonation": "Impersonation",
  "malicious-link": "Malicious link",
  "prohibited-content": "Prohibited content",
};

type Action = "suspend" | "remove-images";

function ReportRow({ report }: { report: OpenReport }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [status, setStatus] = useState(report.profileStatus);

  async function run(action: Action) {
    setBusy(true);
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
      setBusy(false);
    }
  }

  const canAct = Boolean(report.profileId) && reason.trim().length > 0 && !busy;
  return (
    <li className="adminReport">
      <div className="adminReportHead">
        <strong>{REASON_LABELS[report.reason] ?? report.reason}</strong>
        <time dateTime={new Date(report.createdAt * 1000).toISOString()}>{new Date(report.createdAt * 1000).toLocaleString()}</time>
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
            <button className="button buttonSmall" type="button" disabled={!canAct || status === "suspended"} onClick={() => run("suspend")}>Suspend Profile</button>
            <button className="buttonSecondary buttonSmall" type="button" disabled={!canAct} onClick={() => run("remove-images")}>Remove images</button>
          </div>
          <p className="formStatus" role="status">{notice}</p>
        </div>
      )}
    </li>
  );
}

export function AdminReports({ reports }: { reports: OpenReport[] }) {
  if (reports.length === 0) return <p>No open reports.</p>;
  return <ul className="adminReportList">{reports.map((report) => <ReportRow key={report.id} report={report} />)}</ul>;
}
