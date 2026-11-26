"use client";

import { useState, type FormEvent } from "react";
import { campuses, courses, hours, peerId, updatePreview, weekdays, type Adviser, type PreviewState } from "./model";
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
