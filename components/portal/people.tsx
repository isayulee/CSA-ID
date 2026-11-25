"use client";

import { useState, type FormEvent } from "react";
import { campuses, candidates, courses, hours, peerId, updatePreview, weekdays, type Adviser, type PreviewState } from "./model";
import styles from "./portal.module.css";

export function AvailabilityGrid({ slots }: { slots: string[] }) {
  return <div className={styles.tableRegion} tabIndex={0} role="region" aria-label="Weekly Availability grid">
    <table className={`${styles.table} ${styles.availability}`}>
      <thead><tr><th scope="col">Hour</th>{weekdays.map((day) => <th scope="col" key={day}>{day.slice(0, 3)}</th>)}</tr></thead>
      <tbody>{hours.map((hour) => <tr key={hour}><th scope="row">{String(hour).padStart(2, "0")}:00</th>
        {weekdays.map((day, index) => {
          const slot = `${index}-${hour}`;
          return <td key={day}><input type="checkbox" name="slot" value={slot} defaultChecked={slots.includes(slot)} aria-label={`${day} ${hour}:00 to ${hour + 1}:00`} /></td>;
        })}
      </tr>)}</tbody>
    </table>
  </div>;
}

export function Settings({ adviser }: { adviser?: Adviser }) {
  const [notice, setNotice] = useState("");
  if (!adviser) return <><h1>Settings</h1><p>Peer Adviser approval is required to edit Availability.</p></>;

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    updatePreview((state) => ({
      ...state,
      advisers: state.advisers.map((item) => item.id === peerId ? {
        ...item, campus: String(fields.get("campus")), courses: fields.getAll("course").map(String), slots: fields.getAll("slot").map(String),
      } : item),
    }));
    setNotice("Campus, Courses, and Availability saved in this preview.");
  }

  return <>
    <header className={styles.pageHeading}><div><h1>Settings</h1><p>Choose the Courses and hours you can tutor.</p></div></header>
    <form onSubmit={save} className={styles.stack}>
      <div className={`${styles.panel} ${styles.stack}`}>
        <label className={styles.field}>Campus<select name="campus" defaultValue={adviser.campus}>{campuses.map((campus) => <option key={campus}>{campus}</option>)}</select></label>
        <fieldset className={styles.fieldset}><legend>Courses taught</legend><div className={styles.stack}>
          {courses.map((course) => <label key={course.code}><input type="checkbox" name="course" value={course.code} defaultChecked={adviser.courses.includes(course.code)} /> {course.code} · {course.title}</label>)}
        </div></fieldset>
      </div>
      <section className={`${styles.panel} ${styles.stack}`} id="availability" aria-labelledby="availability-heading">
        <h2 id="availability-heading">Weekly Availability</h2>
        <p>Mark the hours you can tutor, in Manila time.</p>
        <AvailabilityGrid slots={adviser.slots} />
      </section>
      <div><button className={styles.button}>Save settings</button></div>
      <small role="status">{notice}</small>
    </form>
  </>;
}

export function Directory({ state }: { state: PreviewState }) {
  const people = state.advisers.toSorted((a, b) => (a.order || 100) - (b.order || 100) || a.name.localeCompare(b.name));
  return <>
    <header className={styles.pageHeading}><div><h1>Directory</h1><p>Find Peer Advisers and Officers by Campus and Course.</p></div></header>
    {people.length === 0 && <p className={styles.panel}>There are no approved Peer Advisers yet.</p>}
    <div className={styles.cards}>{people.map((person) => <article className={`${styles.panel} ${styles.stack}`} key={person.id}>
      <h2>{person.name}</h2>
      <span className={styles.badge}>{person.position || "Peer Adviser"}</span>
      <p>{person.campus}</p>
      <small>{person.courses.length ? person.courses.join(" · ") : "No Courses listed"}</small>
    </article>)}</div>
  </>;
}

export function PeerAdviserApprovals({ state }: { state: PreviewState }) {
  const [notice, setNotice] = useState("");
  const unapproved = candidates.filter((person) => !state.advisers.some((adviser) => person.id === adviser.id));
  function save(event: FormEvent<HTMLFormElement>, adviser: Adviser) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const action = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value");
    const withdrawn = action === "revoke";
    if (withdrawn && !String(fields.get("reason") ?? "").trim()) { setNotice("Give a reason before revoking approval."); return; }
    const position = String(fields.get("position") ?? "").trim();
    const order = Number(fields.get("order"));
    if (!withdrawn && position && (!Number.isInteger(order) || order < 1 || order > 99)) { setNotice("Enter a Directory order from 1 to 99 for an Officer."); return; }
    updatePreview((current) => ({
      ...current,
      advisers: withdrawn ? current.advisers.filter((item) => item.id !== adviser.id) : current.advisers.map((item) =>
        item.id === adviser.id ? { ...item, campus: String(fields.get("campus")), position, order: position ? order : 0 } : item),
      requests: withdrawn ? current.requests.map((item) =>
        item.claimant === adviser.id && ["pending", "rescheduled"].includes(item.status) ? { ...item, claimant: "" } : item) : current.requests,
    }));
    setNotice(withdrawn ? `Revoked approval for ${adviser.name}.` : `Saved changes for ${adviser.name}.`);
  }

  return <>
    <header className={styles.pageHeading}><div><h1>Peer Adviser approvals</h1><p>Approve Peer Advisers and manage Campus and Officer positions.</p></div></header>
    <p role="status">{notice}</p>
    <div className={styles.stack}>
      <h2>Awaiting approval</h2>
      {unapproved.length === 0 && <p className={styles.panel}>No Users awaiting approval.</p>}
      {unapproved.map((person) => <form className={`${styles.panel} ${styles.flex}`} key={person.id} onSubmit={(event) => {
        event.preventDefault();
        const campus = String(new FormData(event.currentTarget).get("campus"));
        updatePreview((current) => ({ ...current, advisers: [...current.advisers, { ...person, campus, courses: [], slots: [], position: "", order: 0 }] }));
        setNotice(`Approved ${person.name} as a Peer Adviser.`);
      }}>
        <strong>{person.name}</strong>
        <label className={styles.field}>Campus<select name="campus">{campuses.map((campus) => <option key={campus}>{campus}</option>)}</select></label>
        <button className={styles.button}>Approve</button>
      </form>)}
      <h2>Approved Peer Advisers</h2>
      {state.advisers.length === 0 && <p className={styles.panel}>No approved Peer Advisers.</p>}
      {state.advisers.map((adviser) => <form key={adviser.id} className={`${styles.panel} ${styles.stack}`} onSubmit={(event) => save(event, adviser)}>
        <h3>{adviser.name}</h3>
        <div className={styles.formGrid}>
          <label className={styles.field}>Campus<select name="campus" defaultValue={adviser.campus}>{campuses.map((campus) => <option key={campus}>{campus}</option>)}</select></label>
          <label className={styles.field}>Officer position<input name="position" defaultValue={adviser.position} maxLength={64} /></label>
          <label className={styles.field}>Directory order<input name="order" type="number" min={1} max={99} defaultValue={adviser.order || ""} /></label>
        </div>
        <div className={styles.flex}><button className={styles.button} value="save">Save changes</button></div>
        <details><summary>Revoke approval</summary><div className={styles.stack}>
          <label className={styles.field}>Reason for revocation<input name="reason" maxLength={1000} /></label>
          <div><button className={styles.secondary} value="revoke">Revoke approval for {adviser.name}</button></div>
        </div></details>
      </form>)}
    </div>
  </>;
}
