"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { AvailabilityGrid } from "./people";
import { campuses, courses, matching, peerId, sampleDay, statuses, updatePreview, weekdays, type AdvisingRequest, type PreviewState, type RequestStatus } from "./model";
import styles from "./portal.module.css";

const statusEntries = Object.entries(statuses);
const views = ["Sessions Today", "Sheet View", "Plan Ahead"] as const;

function updateRequest(id: string, update: (request: AdvisingRequest) => AdvisingRequest) {
  updatePreview((state) => ({
    ...state,
    requests: state.requests.map((request) => request.id === id ? update(request) : request),
  }));
}

function RequestForm({ request, administrator }: { request: AdvisingRequest; administrator: boolean }) {
  const [notice, setNotice] = useState("");

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const date = String(form.get("date") ?? "");
    const time = String(form.get("time") ?? "");
    if (time && !date) { setNotice("Choose a session date before setting the time."); return; }
    const status = String(form.get("status"));
    if (!Object.hasOwn(statuses, status)) return;
    const note = String(form.get("note") ?? "").trim();
    const slots = form.getAll("slot").map(String);
    updateRequest(request.id, (current) => administrator || current.claimant === peerId
      ? { ...current, date, time, status: status as RequestStatus, notes: note ? [...current.notes, note] : current.notes, slots }
      : current);
    const noteInput = event.currentTarget.elements.namedItem("note");
    if (noteInput instanceof HTMLTextAreaElement) noteInput.value = "";
    setNotice("Advising Request updated in this preview.");
  }

  return (
    <form className={styles.stack} onSubmit={save}>
      <div className={styles.formGrid}>
        <label className={styles.field}>Date in Manila<input name="date" type="date" defaultValue={request.date} /></label>
        <label className={styles.field}>Time in Manila<input name="time" type="time" defaultValue={request.time} /></label>
        <label className={styles.field}>Status<select name="status" defaultValue={request.status}>{statusEntries.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      </div>
      <details>
        <summary>Set advisee’s available hours</summary>
        <AvailabilityGrid slots={request.slots} />
      </details>
      <label className={styles.field}>Add a private note<textarea name="note" rows={2} maxLength={2000} /></label>
      <div><button className={styles.button}>Save Advising Request</button></div>
      <small role="status">{notice}</small>
    </form>
  );
}

function RequestCard({ request, state, administrator, expanded }: { request: AdvisingRequest; state: PreviewState; administrator: boolean; expanded?: boolean }) {
  const mine = request.claimant === peerId;
  const canSeeDetails = administrator || mine;
  const canSeeTopic = canSeeDetails || !request.claimant;
  const canClaim = state.advisers.some((person) => person.id === peerId);
  const claimant = state.advisers.find((adviser) => adviser.id === request.claimant)?.name;
  const isOpen = request.status === "pending" || request.status === "rescheduled";
  const suggestions = matching(request, state);

  return (
    <article className={`${styles.panel} ${styles.request}`} id={request.id}>
      <div className={styles.flex}><small>{request.course} · {request.campus}</small><span className={styles.badge} data-status={request.status}>{statuses[request.status]}</span></div>
      <h2>{canSeeTopic ? request.topic : request.course}</h2>
      <div className={styles.details}>
        <p>{claimant ?? (request.claimant ? "Previously assigned" : "Unclaimed")}</p>
        {canSeeDetails && <p>{request.date ? <time dateTime={request.date}>{request.date} {request.time}</time> : "Date to be set"}</p>}
      </div>
      {!request.claimant && (
        <details open={expanded || undefined}>
          <summary>Matching and available times</summary>
          <div className={styles.stack}>
            <small>{request.slots.length ? request.slots.map((slot) => {
              const [day, hour] = slot.split("-").map(Number);
              return `${weekdays[day]} ${hour}:00–${hour + 1}:00`;
            }).join(", ") : "Times unclear. Confirm availability with the advisee."}</small>
            {suggestions.length === 0 ? <p>No Matching suggestions.</p> :
              <ol>{suggestions.map(({ adviser, overlap, open }) => <li key={adviser.id}>{adviser.name} · {overlap} overlapping {overlap === 1 ? "hour" : "hours"} · {open} open</li>)}</ol>}
          </div>
        </details>
      )}
      {canSeeDetails && <details open={expanded || undefined}>
        <summary>Advisee details and private notes</summary>
        <div className={styles.stack}>
          <div><strong>{request.advisee}</strong><br /><small>{request.email}</small></div>
          {request.notes.length > 0 && <ul>{request.notes.map((note, index) => <li key={index}>{note}</li>)}</ul>}
          <RequestForm request={request} administrator={administrator} />
        </div>
      </details>}
      <div className={styles.flex}>
        {canClaim && !request.claimant && isOpen && !administrator && <button className={styles.button} onClick={() => updateRequest(request.id, (current) => current.claimant ? current : { ...current, claimant: peerId })}>Claim Advising Request</button>}
        {mine && isOpen && !administrator && <button className={styles.secondary} onClick={() => updateRequest(request.id, (current) => current.claimant === peerId ? { ...current, claimant: "" } : current)}>Give back</button>}
        {administrator && <form className={styles.flex} onSubmit={(event) => {
          event.preventDefault();
          const claimant = String(new FormData(event.currentTarget).get("adviser") ?? "");
          updateRequest(request.id, (current) => ({ ...current, claimant }));
        }}>
          <label className={styles.field}>Assign Peer Adviser
            <select name="adviser" defaultValue={request.claimant} key={request.claimant}>
              <option value="">Unclaimed</option>
              {state.advisers.map((adviser) => <option key={adviser.id} value={adviser.id}>{adviser.name}</option>)}
            </select>
          </label>
          <button className={styles.button}>Save assignment</button>
        </form>}
      </div>
    </article>
  );
}

export function Scheduler({ state, administrator, requestId }: { state: PreviewState; administrator: boolean; requestId: string }) {
  const [view, setView] = useState<(typeof views)[number]>(requestId || administrator ? "Plan Ahead" : "Sessions Today");
  const [course, setCourse] = useState("");
  const [campus, setCampus] = useState("");
  const [status, setStatus] = useState("");
  const [claimant, setClaimant] = useState("");
  const requests = state.requests.filter((request) =>
    (!course || request.course === course) && (!campus || request.campus === campus) &&
    (!status || request.status === status) && (!claimant || request.claimant === (claimant === "unclaimed" ? "" : claimant)) &&
    (view === "Plan Ahead" || (view === "Sheet View" && Boolean(request.date)) ||
      (view === "Sessions Today" && request.date === sampleDay && (administrator || request.claimant === peerId)))
  );

  return <>
    <header className={styles.pageHeading}>
      <div><h1>{administrator ? "Advising Request assignments" : "Scheduler"}</h1><p>{administrator ? "Review Advising Requests and assign a Peer Adviser." : "Find, claim, and schedule Advising Requests."}</p></div>
      {!administrator && <Link href="/portal/me#availability" className={styles.button}>Set Availability</Link>}
    </header>
    {!administrator && <div className={styles.tabs} aria-label="Scheduler views">
      {views.map((item) => <button type="button" key={item} aria-pressed={view === item} onClick={() => setView(item)}>{item}</button>)}
    </div>}
    <div className={styles.filters} aria-label="Advising Request filters">
      <label className={styles.field}>Course<select value={course} onChange={(e) => setCourse(e.target.value)}><option value="">All Courses</option>{courses.map((item) => <option key={item.code} value={item.code}>{item.code} · {item.title}</option>)}</select></label>
      <label className={styles.field}>Campus<select value={campus} onChange={(e) => setCampus(e.target.value)}><option value="">All Campuses</option>{campuses.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label className={styles.field}>Status<select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option>{statusEntries.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <label className={styles.field}>Claimant<select value={claimant} onChange={(e) => setClaimant(e.target.value)}><option value="">Anyone</option><option value="unclaimed">Unclaimed</option>{state.advisers.map((item) => <option key={item.id} value={item.id}>{!administrator && item.id === peerId ? "My Advising Requests" : item.name}</option>)}</select></label>
    </div>
    {requests.length === 0 ? <p className={styles.panel} role="status">No Advising Requests match this view.</p> : view === "Sheet View" ? (
      <div className={styles.tableRegion} tabIndex={0} role="region" aria-label="Schedule sheet">
        <table className={styles.table}><thead><tr><th>Date</th><th>Time</th><th>Course</th><th>Campus</th><th>Status</th></tr></thead>
          <tbody>{requests.map((request) => <tr key={request.id}><td>{administrator || request.claimant === peerId ? request.date : "—"}</td><td>{administrator || request.claimant === peerId ? request.time : "—"}</td><td>{request.course}</td><td>{request.campus}</td><td>{statuses[request.status]}</td></tr>)}</tbody>
        </table>
      </div>
    ) : <div className={styles.stack}>{requests.map((request) => <RequestCard key={request.id} request={request} state={state} administrator={administrator} expanded={requestId === request.id} />)}</div>}
  </>;
}
