"use client";

import { useState, type FormEvent } from "react";
import { hours, weekdays, type Adviser, type Course } from "./model";
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

type SettingsValues = Pick<Adviser, "campus" | "courses" | "slots">;

type SettingsProps = {
  adviser?: Adviser;
  campuses: readonly string[];
  courses: readonly Course[];
  onSave: (settings: SettingsValues) => string;
  onAddCourse: (course: Course) => void;
};

export function Settings({ adviser, campuses, courses, onSave, onAddCourse }: SettingsProps) {
  const [notice, setNotice] = useState("");
  const [courseError, setCourseError] = useState("");
  if (!adviser) return <><h1>Settings</h1><p>Peer Adviser approval is required to edit Availability.</p></>;

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setNotice(onSave({
      campus: String(fields.get("campus")),
      courses: fields.getAll("course").map(String),
      slots: fields.getAll("slot").map(String),
    }));
  }

  function addCourse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const code = String(fields.get("code") ?? "").trim().toUpperCase();
    const title = String(fields.get("title") ?? "").trim();
    setCourseError("");
    setNotice("");
    if (!code || !title) {
      setCourseError("Enter the Course code and title.");
      return;
    }
    if (courses.some((course) => course.code === code)) {
      setCourseError(`${code} is already in the Course list.`);
      return;
    }
    onAddCourse({ code, title });
    form.reset();
    setNotice(`Added ${code}. Select it under Courses taught to add it to your settings.`);
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
    </form>
    <form onSubmit={addCourse} className={`${styles.panel} ${styles.stack}`} aria-labelledby="add-course-heading">
      <h2 id="add-course-heading">Add a Course</h2>
      <div className={styles.formGrid}>
        <label className={styles.field}>Course code<input name="code" required maxLength={32} /></label>
        <label className={styles.field}>Course title<input name="title" required maxLength={128} /></label>
      </div>
      <div><button className={styles.secondary}>Add Course</button></div>
      <p role="alert" className={styles.error}>{courseError}</p>
    </form>
    <p role="status">{notice}</p>
  </>;
}

type DirectoryEntry = Pick<Adviser, "id" | "name" | "position" | "order" | "campus" | "courses">;

export function Directory({ advisers }: { advisers: readonly DirectoryEntry[] }) {
  const people = advisers.toSorted((a, b) => {
    if (a.position && b.position) return a.order - b.order || a.name.localeCompare(b.name);
    if (a.position) return -1;
    if (b.position) return 1;
    return a.name.localeCompare(b.name);
  });
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
