"use client";

import Link from "next/link";
import { useCallback, useState, type FormEvent } from "react";
import type { HourSlot } from "@/lib/advising-slots";
import { rankPeerAdvisers, type NoSuggestionReason } from "@/lib/matching";
import { AvailabilityGrid } from "./people";
import { campuses, courses, peerId, sampleDay, statuses, updatePreview, weekdays, type AdvisingRequest, type PreviewState, type RequestStatus } from "./model";
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

const weekdaysForMatching = [1, 2, 3, 4, 5, 6] as const;
const hoursForMatching = [8, 9, 10, 11, 12, 13, 14, 15, 16] as const;
const matchingReasons: Record<NoSuggestionReason, string> = {
  course_missing: "The Course is missing.",
  campus_missing: "The Campus is missing.",
  times_unclear: "The Advisee’s available times are unclear.",
};

function matchingSlots(slots: readonly string[]): HourSlot[] {
  return slots.flatMap((slot) => {
    const [day, start] = slot.split("-").map(Number);
    const weekday = weekdaysForMatching[day];
    const hour = hoursForMatching.find((hour) => hour === start);
    return weekday && hour ? [{ weekday, hour }] : [];
  });
}

function MatchingSuggestions({ request, state }: { request: AdvisingRequest; state: PreviewState }) {
  const slots = matchingSlots(request.slots);
  const advisersById = new Map(state.advisers.map((adviser) => [adviser.id, adviser]));
  const openRequestsByAdviser = new Map<string, number>();
  for (const item of state.requests) {
    if (item.claimant && (item.status === "pending" || item.status === "rescheduled")) {
      openRequestsByAdviser.set(item.claimant, (openRequestsByAdviser.get(item.claimant) ?? 0) + 1);
    }
  }
  const result = rankPeerAdvisers({
    courseCode: request.course || null,
    campusId: request.campus || null,
    timesUnclear: slots.length === 0,
    slots,
  }, state.advisers.map((adviser) => ({
    userId: adviser.id,
    campusId: adviser.campus,
    courseCodes: adviser.courses,
    availability: matchingSlots(adviser.slots),
    claimedPendingOrRescheduledCount: openRequestsByAdviser.get(adviser.id) ?? 0,
  })));

  if (!result.ok) return <ul>{result.reasons.map((reason) => <li key={reason}>{matchingReasons[reason]}</li>)}</ul>;
  if (result.suggestions.length === 0) return <p>No Peer Adviser teaches this Course on the requested Campus.</p>;
  return <ol>{result.suggestions.map((suggestion) => <li key={suggestion.userId}>
    {advisersById.get(suggestion.userId)?.name} · {suggestion.matchingSlots} overlapping {suggestion.matchingSlots === 1 ? "hour" : "hours"} · {suggestion.claimedPendingOrRescheduledCount} open
  </li>)}</ol>;
}

function teamsChat(request: AdvisingRequest, adviserName: string) {
  const url = new URL("https://teams.microsoft.com/l/chat/0/0");
  const start = request.time ? ` at ${request.time} Manila time` : "";
  url.searchParams.set("users", request.email);
  url.searchParams.set("message", `Hi ${request.advisee}, I’m ${adviserName}, your Peer Adviser for ${request.course}. Our session is scheduled for ${request.date}${start}.`);
  return url.href;
}

function RequestCard({ request, state, administrator, expanded }: { request: AdvisingRequest; state: PreviewState; administrator: boolean; expanded?: boolean }) {
  const mine = request.claimant === peerId;
  const canSeeDetails = administrator || mine;
  const canSeeTopic = canSeeDetails || !request.claimant;
  const canClaim = state.advisers.some((person) => person.id === peerId);
  const claimant = state.advisers.find((adviser) => adviser.id === request.claimant)?.name;
  const isOpen = request.status === "pending" || request.status === "rescheduled";
  const chat = mine && claimant && request.email && request.date ? teamsChat(request, claimant) : null;

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
            <MatchingSuggestions request={request} state={state} />
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
        {chat && <a className={styles.secondary} href={chat} target="_blank" rel="noreferrer">Notify on Teams</a>}
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

function RequestSheet({ view, requests, state, requestId }: {
  view: "Sheet View" | "Plan Ahead";
  requests: AdvisingRequest[];
  state: PreviewState;
  requestId: string;
}) {
  const [selectedId, setSelectedId] = useState(requestId);
  const focusDetails = useCallback((element: HTMLElement | null) => element?.focus(), []);
  const selected = requests.find((request) => request.id === selectedId);

  return (
    <section className={styles.stack} aria-labelledby="schedule-sheet-heading">
      <h2 id="schedule-sheet-heading">{view}</h2>
      <div className={`${styles.tableRegion} ${styles.scheduleSheet}`} tabIndex={0} role="region" aria-label={`${view} Advising Requests`}>
        <table className={styles.table}>
          <thead><tr>
            <th scope="col">Date</th><th scope="col">Time</th><th scope="col">Session</th><th scope="col">Campus</th>
            <th scope="col">{view === "Plan Ahead" ? "Status" : "Peer Adviser"}</th>
          </tr></thead>
          <tbody>{requests.map((request) => {
            const canSeeSession = !request.claimant || request.claimant === peerId;
            const adviser = state.advisers.find((person) => person.id === request.claimant);
            const title = canSeeSession ? request.topic || request.course : request.course;
            const isSelected = selected?.id === request.id;
            return <tr key={request.id}>
              <td>{canSeeSession ? request.date || "To be set" : "—"}</td>
              <td>{canSeeSession ? request.time || "—" : "—"}</td>
              <th scope="row">
                <button className={styles.sheetRequest} type="button" aria-expanded={isSelected} aria-controls={isSelected ? "schedule-request-details" : undefined} onClick={() => setSelectedId(isSelected ? "" : request.id)}>
                  {title}
                </button>
                {title !== request.course && <small className={styles.sheetCourse}>{request.course}</small>}
              </th>
              <td>{request.campus}</td>
              <td>{view === "Plan Ahead"
                ? <span className={styles.badge} data-status={request.status}>{statuses[request.status]}</span>
                : adviser?.name ?? (request.claimant ? "Previously assigned" : "Unclaimed")}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>
      {selected && <section id="schedule-request-details" aria-label="Selected Advising Request" key={selected.id} ref={focusDetails} tabIndex={-1}>
        <RequestCard request={selected} state={state} administrator={false} expanded />
      </section>}
    </section>
  );
}

export function Scheduler({ state, administrator, requestId }: { state: PreviewState; administrator: boolean; requestId: string }) {
  const [view, setView] = useState<(typeof views)[number]>(() => {
    if (!requestId) return "Sessions Today";
    return state.requests.find((request) => request.id === requestId)?.sheet === "plan-ahead" ? "Plan Ahead" : "Sheet View";
  });
  const [course, setCourse] = useState("");
  const [campus, setCampus] = useState("");
  const [status, setStatus] = useState("");
  const [claimant, setClaimant] = useState("");
  const availableCourses = [...courses, ...(state.addedCourses ?? [])];
  const requests = state.requests.filter((request) =>
    (!course || request.course === course) && (!campus || request.campus === campus) &&
    (!status || request.status === status) && (!claimant || request.claimant === (claimant === "unclaimed" ? "" : claimant)) &&
    (administrator || (view === "Plan Ahead" ? request.sheet === "plan-ahead" :
      request.sheet === "schedule" && (view === "Sheet View" || (request.date === sampleDay && request.claimant === peerId))))
  );

  return <>
    <header className={styles.pageHeading}>
      <div><h1>{administrator ? "Advising Request assignments" : "Scheduler"}</h1><p>{administrator ? "Review Advising Requests and assign a Peer Adviser." : "Find, claim, and schedule Advising Requests."}</p></div>
      {!administrator && <Link href="/portal/me#availability" className={styles.button}>Set Availability</Link>}
    </header>
    {!administrator && <div className={styles.tabs} aria-label="Scheduler views">
      {views.map((item) => <button type="button" key={item} aria-pressed={view === item} onClick={() => setView(item)}>{item}</button>)}
    </div>}
    <div className={`${styles.filters} ${styles.schedulerFilters}`} aria-label="Advising Request filters">
      <label className={styles.field}>Course<select value={course} onChange={(e) => setCourse(e.target.value)}><option value="">All Courses</option>{availableCourses.map((item) => <option key={item.code} value={item.code}>{item.code} · {item.title}</option>)}</select></label>
      <label className={styles.field}>Campus<select value={campus} onChange={(e) => setCampus(e.target.value)}><option value="">All Campuses</option>{campuses.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label className={styles.field}>Status<select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option>{statusEntries.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <label className={styles.field}>Claimant<select value={claimant} onChange={(e) => setClaimant(e.target.value)}><option value="">Anyone</option><option value="unclaimed">Unclaimed</option>{state.advisers.map((item) => <option key={item.id} value={item.id}>{!administrator && item.id === peerId ? "My Advising Requests" : item.name}</option>)}</select></label>
    </div>
    {requests.length === 0 ? <p className={styles.panel} role="status">No Advising Requests match this view.</p> : !administrator && view !== "Sessions Today" ? (
      <RequestSheet key={view} view={view} requests={requests} state={state} requestId={requestId} />
    ) : <div className={styles.stack}>{requests.map((request) => <RequestCard key={request.id} request={request} state={state} administrator={administrator} expanded={requestId === request.id} />)}</div>}
  </>;
}
