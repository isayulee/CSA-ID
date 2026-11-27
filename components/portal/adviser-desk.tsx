"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { DashboardEditor, type DashboardData } from "@/components/dashboard-editor";
import { AvailabilityGrid } from "./people";
import { MyTasksPrototype, TasksPrototype } from "./tasks-prototype";
import { KitDraftDialog, validMaterialLink } from "./teaching-kits";
import { academicTerm, campuses, courses, getPreview, getSeed, peerId, statuses, subscribe, updatePreview, weekdays, type Adviser, type AdvisingRequest, type Course, type Kit, type PreviewState } from "./model";
import styles from "./adviser-desk.module.css";

const screens = [
  { id: "home", label: "Home", href: "/portal", icon: "home" },
  { id: "scheduler", label: "Scheduler", href: "/portal/scheduler", icon: "calendar" },
  { id: "tasks", label: "Tasks", href: "/portal/tasks", icon: "tasks" },
  { id: "kits", label: "Teaching Kits", href: "/portal/kits", icon: "book" },
  { id: "directory", label: "Directory", href: "/portal/directory", icon: "people" },
  { id: "me", label: "Settings", href: "/portal/me", icon: "settings" },
  { id: "profile", label: "Profile", href: "/portal/profile", icon: "profile" },
] as const;

type Area = (typeof screens)[number]["id"];
const themeKey = "csa-adviser-desk-theme";
const themeListeners = new Set<() => void>();
const photoListeners = new Set<() => void>();
let darkPreference: boolean | undefined;
let directoryPhoto: string | null = null;
const getDirectoryPhoto = () => directoryPhoto;
const noPhoto = () => null;
const lightTheme = () => false;

function watchTheme(listener: () => void) {
  themeListeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== themeKey) return;
    darkPreference = undefined;
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    themeListeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function isDark() {
  if (darkPreference !== undefined) return darkPreference;
  try { return localStorage.getItem(themeKey) === "dark"; } catch { return false; }
}

function setDark(dark: boolean) {
  darkPreference = dark;
  try { localStorage.setItem(themeKey, dark ? "dark" : "light"); } catch { /* Keep the in-memory choice. */ }
  themeListeners.forEach((listener) => listener());
}

function watchDirectoryPhoto(listener: () => void) {
  photoListeners.add(listener);
  return () => { photoListeners.delete(listener); };
}

function setDirectoryPhoto(file?: File) {
  if (directoryPhoto) URL.revokeObjectURL(directoryPhoto);
  directoryPhoto = file ? URL.createObjectURL(file) : null;
  photoListeners.forEach((listener) => listener());
}

const icons = {
  home: "m3 10 9-7 9 7v10H3z M9 20v-6h6v6",
  calendar: "M4 6h16v14H4z M8 3v6m8-6v6M4 11h16m-12 4h3m2 0h3",
  tasks: "M4 5h16M4 12h10M4 19h16m-4-8 2 2 3-4",
  book: "M12 6c-3-2-6-2-9-1v14c3-1 6-1 9 1 3-2 6-2 9-1V5c-3-1-6-1-9 1v14",
  people: "M4 20v-2a4 4 0 0 1 4-4h3a4 4 0 0 1 4 4v2M16 14a4 4 0 0 1 4 4v2M13 8a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0Zm3-3a3.5 3.5 0 0 1 0 7",
  settings: "M4 7h16M4 17h16M8 4v6m8 4v6",
  profile: "M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0ZM14.5 10a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0ZM7 17a6 6 0 0 1 10 0",
  moon: "M20.6 14A8.5 8.5 0 0 1 10 3.4 8.5 8.5 0 1 0 20.6 14Z",
  arrow: "M4 12h15m-6-6 6 6-6 6",
  back: "M20 12H5m6-6-6 6 6 6",
  close: "m6 6 12 12M18 6 6 18",
  expand: "M14 4h6v6m0-6-6 6M10 20H4v-6m0 6 6-6",
  file: "M6 3h8l4 4v14H6z M14 3v5h4M9 12h6m-6 4h6",
} as const;

function Icon({ name }: { name: keyof typeof icons }) {
  return <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round"><path d={icons[name]} /></svg>;
}

function Mark() {
  return <span className={styles.mark} aria-hidden="true"><i /><i /><i /><i /></span>;
}

function SidebarPattern() {
  return <div className={styles.sidePattern} aria-hidden="true">
    {Array.from({ length: 8 }, (_, index) => <Mark key={index} />)}
  </div>;
}

function ManilaClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const refresh = () => setNow(new Date());
    refresh();
    const timer = window.setInterval(refresh, 15_000);
    return () => window.clearInterval(timer);
  }, []);
  if (!now) return <time className={styles.clock}>Manila time</time>;
  const date = new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", weekday: "short", month: "short", day: "numeric" }).format(now);
  const time = new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" }).format(now);
  return <time className={styles.clock} dateTime={now.toISOString()}>{date} <span aria-hidden="true">·</span> {time} PHT</time>;
}

function QuickPreview({ title, close, children, action }: {
  title: string; close: () => void; children: ReactNode; action?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
  }, []);
  return <dialog ref={ref} className={styles.dialog} aria-labelledby={titleId} onClose={close}>
    <header className={styles.dialogBar}>
      <h2 id={titleId}>{title}</h2>
      <div>{action}<button type="button" className={styles.iconButton} aria-label="Close preview" onClick={() => ref.current?.close()}><Icon name="close" /></button></div>
    </header>
    <div className={styles.dialogBody}>{children}</div>
  </dialog>;
}

function KitList({ kits, open }: { kits: readonly Kit[]; open: (kit: Kit) => void }) {
  return kits.length ? <ul className={styles.kitList}>{kits.map((kit) =>
    <li key={kit.id}><button type="button" onClick={() => open(kit)} aria-haspopup="dialog">
      <span className={styles.kitIcon}><Icon name="book" /></span>
      <span className={styles.kitTitle}><strong>{kit.title}</strong><small>{kit.course} · {academicTerm(kit.year, kit.term)}</small></span>
      <Icon name="arrow" />
    </button></li>
  )}</ul> : <p className={styles.empty}>No Teaching Kits match.</p>;
}

function KitContents({ kit, full }: { kit: Kit; full?: boolean }) {
  return <div className={styles.kitContents}>
    <p className={styles.metadata}>{kit.course} · {academicTerm(kit.year, kit.term)}</p>
    <h3>{full ? "Resources" : "Recent resources"}</h3>
    <details className={styles.resource} open>
      <summary><Icon name="file" /> Teaching notes</summary>
      <p>{kit.body || "No teaching notes in this kit."}</p>
    </details>
    {kit.link && validMaterialLink(kit.link) && <a href={kit.link} className={styles.resource} target="_blank" rel="noreferrer">Open teaching material <Icon name="arrow" /></a>}
    {kit.pdf && <p className={styles.resource}><Icon name="file" /> {kit.pdf}</p>}
  </div>;
}

function Library({ state, availableCourses, kitId, editKit, open }: {
  state: PreviewState;
  availableCourses: readonly Course[];
  kitId?: string;
  editKit?: boolean;
  open: (kit: Kit) => void;
}) {
  const [query, setQuery] = useState("");
  const [course, setCourse] = useState("");
  const [term, setTerm] = useState("");
  const [draftView, setDraftView] = useState(false);
  const canPropose = state.advisers.some((adviser) => adviser.id === peerId);
  const kit = state.kits.find((item) => item.id === kitId);
  const ownDrafts = state.drafts.filter((draft) => draft.author === peerId && draft.state !== "approved");
  const pending = ownDrafts.find((draft) => draft.id === kitId && draft.state === "pending");
  const draftEditor = editKit && canPropose && (kit || pending || kitId === "new") &&
    <KitDraftDialog key={kitId} kit={kit} draft={pending} availableCourses={availableCourses} />;

  if (kitId && kitId !== "new") {
    return <>
      <Link className={styles.back} href="/portal/kits"><Icon name="back" /> All Teaching Kits</Link>
      <h1>{kit?.title ?? pending?.title ?? "Teaching Kit unavailable"}</h1>
      {kit && <section className={styles.panel}><KitContents kit={kit} full />
        {pending && <p>Your Kit Draft is pending review.</p>}
        {canPropose && <Link href={`/portal/kits/${kit.id}/edit`} className={styles.textLink}>{pending ? "Edit Kit Draft" : "Propose changes"}</Link>}
      </section>}
      {!kit && pending && <section className={styles.panel}>
        <p>This Kit Draft is pending review.</p>
        {canPropose && <Link href={`/portal/kits/${pending.id}/edit`} className={styles.textLink}>Edit Kit Draft</Link>}
      </section>}
      {draftEditor}
    </>;
  }

  const terms = [...new Set(state.kits.map((item) => academicTerm(item.year, item.term)))];
  const visibleKits = state.kits.filter((item) => (!course || item.course === course)
    && (!term || term === academicTerm(item.year, item.term))
    && `${item.course} ${item.title} ${item.body}`.toLowerCase().includes(query.trim().toLowerCase()));

  return <>
    <div className={styles.libraryHeading}>
      <div className={styles.heading}><h1>Teaching Kits</h1><p>Browse approved materials by title, Course, or Academic Term.</p></div>
      {canPropose && <Link className={styles.primary} href="/portal/kits/new">Add a Teaching Kit</Link>}
    </div>
    <div className={styles.tabs} role="group" aria-label="Teaching Kit views">
      <button type="button" aria-pressed={!draftView} onClick={() => setDraftView(false)}>Approved Teaching Kits</button>
      <button type="button" aria-pressed={draftView} onClick={() => setDraftView(true)}>My Kit Drafts</button>
    </div>
    {draftView ? <div className={styles.settings}>
      {ownDrafts.length === 0 && <p className={styles.empty}>You have no Kit Drafts.</p>}
      {ownDrafts.map((draft, index) => <article className={styles.panel} key={`${draft.id}-${index}`}>
        <h2>{draft.title}</h2>
        <p>{draft.course} · {academicTerm(draft.year, draft.term)} · {draft.state === "pending" ? "Pending review" : "Rejected"}</p>
        {draft.state === "pending" && canPropose && <Link className={styles.textLink} href={`/portal/kits/${draft.id}/edit`}>Edit Kit Draft</Link>}
        {draft.state === "rejected" && <p>Review note: {draft.note}</p>}
      </article>)}
    </div> : <>
      <div className={`${styles.filters} ${styles.libraryFilters}`}>
        <label>Search Teaching Kits<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Title, Course code, or topic" /></label>
        <label>Course<select value={course} onChange={(event) => setCourse(event.target.value)}><option value="">All Courses</option>{availableCourses.map(({ code }) => <option key={code}>{code}</option>)}</select></label>
        <label>Academic Term<select value={term} onChange={(event) => setTerm(event.target.value)}><option value="">All terms</option>{terms.map((item) => <option key={item}>{item}</option>)}</select></label>
      </div>
      <KitList kits={visibleKits} open={open} />
    </>}
    {draftEditor}
  </>;
}

function Home({ adviser, kits, openKit }: { adviser?: Adviser; kits: readonly Kit[]; openKit: (kit: Kit) => void }) {
  const courseKits = kits.filter((kit) => adviser?.courses.includes(kit.course));
  return <div>
    <header className={styles.greeting}>
      <div><ManilaClock /><h1>{adviser ? `Hello, ${adviser.name.split(" ")[0]}.` : "Adviser Desk"}</h1></div>
      <div className={styles.greetingPattern} aria-hidden="true"><i /><i /><i /><i /></div>
    </header>
    <div className={styles.overview}>
      <section aria-labelledby="desk-kits">
        <div className={styles.sectionTitle}><h2 id="desk-kits">Teaching Kits for your Courses</h2><Link href="/portal/kits">View all</Link></div>
        <KitList kits={courseKits} open={openKit} />
      </section>
      <Link href="/portal/scheduler" className={styles.sheetLink}>
        <span className={styles.kitIcon}><Icon name="calendar" /></span>
        <span><strong>Scheduler</strong><small>Browse the schedule and find available Peer Advisers.</small></span>
        <Icon name="arrow" />
      </Link>
    </div>
  </div>;
}

function displaySlot(slot: string) {
  const [day, hour] = slot.split("-").map(Number);
  return `${weekdays[day]?.slice(0, 3)} ${String(hour).padStart(2, "0")}:00`;
}

type SheetRequest = Pick<AdvisingRequest, "id" | "course" | "campus" | "topic" | "sheet" | "status" | "date" | "time" | "slots">;

function ReadOnlyScheduler({ advisers, requests, availableCourses, requestId }: {
  advisers: readonly Adviser[];
  requests: readonly SheetRequest[];
  availableCourses: readonly Course[];
  requestId?: string;
}) {
  const initial = requests.find((request) => request.id === requestId);
  const [sheet, setSheet] = useState<AdvisingRequest["sheet"]>(initial?.sheet ?? "schedule");
  const [course, setCourse] = useState("");
  const [campus, setCampus] = useState("");
  const [selected, setSelected] = useState<SheetRequest | undefined>(initial);
  const rows = requests.filter((request) => request.sheet === sheet && (!course || course === request.course) && (!campus || campus === request.campus));
  const available = selected ? advisers.filter((adviser) => adviser.campus === selected.campus && adviser.courses.includes(selected.course))
    .map((adviser) => ({ adviser, slots: selected.slots.filter((slot) => adviser.slots.includes(slot)) }))
    .filter(({ slots }) => slots.length > 0).sort((a, b) => b.slots.length - a.slots.length || a.adviser.name.localeCompare(b.adviser.name)) : [];

  return <>
    <div className={styles.heading}><h1>Scheduler</h1><p>View the schedule sheets and check Peer Adviser Availability.</p></div>
    <div className={styles.sheetControls}>
      <div className={styles.tabs} role="group" aria-label="Schedule sheet">
        <button type="button" aria-pressed={sheet === "schedule"} onClick={() => setSheet("schedule")}>Sheet View</button>
        <button type="button" aria-pressed={sheet === "plan-ahead"} onClick={() => setSheet("plan-ahead")}>Plan Ahead</button>
      </div>
      <span className={styles.readOnly}>Read-only</span>
    </div>
    <div className={styles.filters}>
      <label>Course<select value={course} onChange={(event) => setCourse(event.target.value)}><option value="">All Courses</option>{availableCourses.map(({ code }) => <option key={code}>{code}</option>)}</select></label>
      <label>Campus<select value={campus} onChange={(event) => setCampus(event.target.value)}><option value="">All Campuses</option>{campuses.map((item) => <option key={item}>{item}</option>)}</select></label>
    </div>
    {rows.length ? <div className={styles.sheetTable} tabIndex={0} role="region" aria-label="Schedule sheet">
      <table><thead><tr><th scope="col">Session</th><th scope="col">Date and time</th><th scope="col">Campus</th><th scope="col">Status</th></tr></thead>
        <tbody>{rows.map((request) => <tr key={request.id}>
          <th scope="row"><button type="button" onClick={() => setSelected(request)} aria-haspopup="dialog"><span>{request.topic}<small>{request.course}</small></span><Icon name="arrow" /></button></th>
          <td>{request.date ? <time dateTime={request.date}>{request.date}{request.time ? ` · ${request.time}` : ""}</time> : "To be set"}</td>
          <td>{request.campus}</td><td>{statuses[request.status]}</td>
        </tr>)}</tbody>
      </table>
    </div> : <p className={styles.empty}>No rows match these filters.</p>}
    {selected && <QuickPreview title="Available Peer Advisers" close={() => setSelected(undefined)}>
      <p className={styles.metadata}>{selected.course} · {selected.campus}</p>
      {available.length > 0 ? <ul className={styles.availabilityMatches}>{available.map(({ adviser, slots }) => <li key={adviser.id}><strong>{adviser.name}</strong><small>{slots.map(displaySlot).join(" · ")}</small></li>)}</ul> :
        <p>{selected.slots.length ? "No Peer Advisers have overlapping hours for this Course and Campus." : "This row has no usable time slots to compare."}</p>}
    </QuickPreview>}
  </>;
}

function Avatar({ adviser, photo, large }: { adviser: Adviser; photo: string | null; large?: boolean }) {
  const initials = adviser.name.split(/\s+/).slice(0, 2).map((name) => name[0]).join("");
  return <span aria-hidden="true" className={styles.avatar} data-large={large || undefined}
    style={photo ? { backgroundImage: `url("${photo}")` } : undefined}>{photo ? "" : initials}</span>;
}

function Directory({ advisers, photo, availableCourses }: { advisers: readonly Adviser[]; photo: string | null; availableCourses: readonly Course[] }) {
  const [selected, setSelected] = useState<Adviser>();
  const people = advisers.toSorted((a, b) => {
    if (a.position && b.position) return a.order - b.order || a.name.localeCompare(b.name);
    if (a.position) return -1;
    if (b.position) return 1;
    return a.name.localeCompare(b.name);
  });
  const slug = selected?.id === peerId ? "demo" : null;
  return <>
    <div className={styles.heading}><h1>Directory</h1><p>Find Peer Advisers by Campus and Course.</p></div>
    {people.length === 0 && <p className={styles.empty}>There are no approved Peer Advisers yet.</p>}
    <ul className={styles.people}>{people.map((adviser) => <li key={adviser.id}>
      <button type="button" onClick={() => setSelected(adviser)} aria-haspopup="dialog">
        <Avatar adviser={adviser} photo={adviser.id === peerId ? photo : null} />
        <span><strong>{adviser.name}</strong><small>{adviser.position || "Peer Adviser"} · {adviser.campus}</small><small>{adviser.courses.join(" · ") || "No Courses listed"}</small></span>
        <Icon name="arrow" />
      </button>
    </li>)}</ul>
    {selected && <QuickPreview title="Profile preview" close={() => setSelected(undefined)}
      action={slug && <Link href={`/id/${slug}`} className={styles.iconButton} aria-label="Open full Published Profile"><Icon name="expand" /></Link>}>
      <div className={styles.profileHeader}>
        <Avatar adviser={selected} photo={selected.id === peerId ? photo : null} large />
        <div><h3>{selected.name}</h3><p>{selected.position || "Peer Adviser"} · {selected.campus}</p></div>
      </div>
      <h3>Courses taught</h3>
      <ul className={styles.profileCourses}>{selected.courses.map((code) => <li key={code}><strong>{code}</strong> {availableCourses.find((course) => course.code === code)?.title}</li>)}</ul>
      {slug ? <Link className={styles.textLink} href={`/id/${slug}`}>Open Published Profile <Icon name="expand" /></Link> :
        <p className={styles.metadata}>No Published Profile is available in this preview.</p>}
    </QuickPreview>}
  </>;
}

function Settings({ adviser, photo, availableCourses }: { adviser: Adviser; photo: string | null; availableCourses: readonly Course[] }) {
  const [notice, setNotice] = useState("");
  const [photoError, setPhotoError] = useState("");
  const [courseError, setCourseError] = useState("");
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const changes = {
      campus: String(form.get("campus")),
      courses: form.getAll("course").map(String),
      slots: form.getAll("slot").map(String),
    };
    updatePreview((state) => ({
      ...state, advisers: state.advisers.map((person) => person.id === adviser.id ? { ...person, ...changes } : person),
    }));
    setNotice("Campus, Courses, and Availability saved in this preview.");
  }
  function addCourse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const code = String(fields.get("code") ?? "").trim().toUpperCase();
    const title = String(fields.get("title") ?? "").trim();
    setCourseError("");
    if (!code || !title) {
      setCourseError("Enter the Course code and title.");
      return;
    }
    if (availableCourses.some((item) => item.code === code)) {
      setCourseError(`${code} is already in the Course list.`);
      return;
    }
    updatePreview((state) => ({ ...state, addedCourses: [...(state.addedCourses ?? []), { code, title }] }));
    form.reset();
    setNotice(`Added ${code}. Select it under Courses taught to add it to your settings.`);
  }
  function setPhoto(file?: File) {
    setPhotoError("");
    if (file && (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type) || file.size > 5 * 1024 * 1024)) {
      setPhotoError("Choose a JPG, PNG, WebP, or GIF up to 5 MB.");
      return;
    }
    setDirectoryPhoto(file);
  }
  return <>
    <div className={styles.heading}><h1>Settings</h1><p>Manage your Directory photo, Courses, and weekly Availability.</p></div>
    <div className={styles.settings}>
      <section className={styles.panel}>
        <h2>Directory photo</h2>
        <div className={styles.photoControls}>
          <Avatar adviser={adviser} photo={photo} large />
          <div><label className={styles.photoPicker}><span>{photo ? "Change photo" : "Add optional photo"}</span><input className="srOnly" type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) setPhoto(file);
            event.target.value = "";
          }} /></label>
            {photo && <button type="button" className={styles.textLink} onClick={() => setPhoto()}>Remove photo</button>}
          </div>
        </div>
        {photoError && <p role="alert">{photoError}</p>}
      </section>
      <form onSubmit={save} className={styles.settings}>
        <section className={styles.panel}>
          <h2>Tutoring details</h2>
          <label>Campus<select name="campus" defaultValue={adviser.campus}>{campuses.map((campus) => <option key={campus}>{campus}</option>)}</select></label>
          <fieldset><legend>Courses taught</legend><div className={styles.checkItems}>{availableCourses.map((course) => <label key={course.code}><input type="checkbox" name="course" value={course.code} defaultChecked={adviser.courses.includes(course.code)} /> {course.code} · {course.title}</label>)}</div></fieldset>
        </section>
        <section className={styles.panel} id="availability">
          <h2>Weekly Availability</h2><p>Mark the hours you can tutor, in Manila time.</p>
          <div className={styles.availability}><AvailabilityGrid slots={adviser.slots} /></div>
        </section>
        <div className={styles.save}><button type="submit" className={styles.primary}>Save settings</button><span role="status">{notice}</span></div>
      </form>
      <form className={styles.panel} onSubmit={addCourse} aria-labelledby="add-course-heading">
        <h2 id="add-course-heading">Add a Course</h2>
        <div className={styles.filters}>
          <label>Course code<input name="code" required maxLength={32} /></label>
          <label>Course title<input name="title" required maxLength={128} /></label>
        </div>
        <div><button className={styles.primary} type="submit">Add Course</button></div>
        {courseError && <p role="alert">{courseError}</p>}
      </form>
    </div>
  </>;
}

export function AdviserDesk({ area, kitId, editKit, requestId, profileEditor, tasksPrototype }: {
  area: Area;
  kitId?: string;
  editKit?: boolean;
  requestId?: string;
  profileEditor?: DashboardData | null;
  tasksPrototype?: React.ComponentProps<typeof TasksPrototype>;
}) {
  const state = useSyncExternalStore(subscribe, getPreview, getSeed);
  const dark = useSyncExternalStore(watchTheme, isDark, lightTheme);
  const photo = useSyncExternalStore(watchDirectoryPhoto, getDirectoryPhoto, noPhoto);
  const adviser = state.advisers.find((person) => person.id === peerId);
  const availableCourses = [...courses, ...(state.addedCourses ?? [])];
  const [kit, setKit] = useState<Kit | null>(null);
  return <div className={styles.desk} data-theme={dark ? "dark" : "light"}>
    <a className={styles.skip} href="#adviser-desk-main">Skip to content</a>
    <aside className={styles.sidebar}>
      <Link className={styles.brand} href="/portal"><Mark /> <span>Adviser Desk</span></Link>
      <nav aria-label="Adviser Desk">{screens.map((screen) =>
        <Link key={screen.id} href={screen.href} aria-current={screen.id === area ? "page" : undefined}><Icon name={screen.icon} /><span>{screen.label}</span></Link>
      )}</nav>
      <SidebarPattern />
    </aside>
    <div className={styles.work}>
      <header className={styles.topBar}>
        {area !== "profile" && <span className={styles.previewNotice}>Local preview · Sample data</span>}
        <div className={styles.topActions}>
          <button className={styles.theme} type="button" aria-pressed={dark} aria-label="Dark mode" onClick={() => setDark(!dark)}>
            <Icon name="moon" /><span>Dark mode</span>
          </button>
          <Link href="/portal/profile" aria-label="Open Profile editor">{adviser ? <Avatar adviser={adviser} photo={photo} /> : <Icon name="profile" />}</Link>
        </div>
      </header>
      <main id="adviser-desk-main" className={styles.main}>
        {area === "home" && <><Home adviser={adviser} kits={state.kits} openKit={setKit} /><MyTasksPrototype /></>}
        {area === "tasks" && tasksPrototype && <TasksPrototype key={`${tasksPrototype.boardId ?? ""}:${tasksPrototype.taskId ?? ""}`} {...tasksPrototype} />}
        {area === "kits" && <Library state={state} availableCourses={availableCourses} kitId={kitId} editKit={editKit} open={setKit} />}
        {area === "scheduler" && <ReadOnlyScheduler key={requestId} advisers={state.advisers} requests={state.requests} availableCourses={availableCourses} requestId={requestId} />}
        {area === "directory" && <Directory advisers={state.advisers} photo={photo} availableCourses={availableCourses} />}
        {area === "me" && (adviser ? <Settings adviser={adviser} photo={photo} availableCourses={availableCourses} /> : <><h1>Settings</h1><p>Peer Adviser approval is required to edit Availability.</p></>)}
        {area === "profile" && (profileEditor ? <div className={styles.profileWorkspace}>
          <DashboardEditor key={profileEditor.user.email} initial={profileEditor} />
        </div> : <>
          <div className={styles.heading}><h1>Profile</h1><p>Sign in to edit, preview, and publish a Profile.</p></div>
          <div className={styles.panel}>
            <p>Use the local development account to try the full Profile editor in Adviser Desk.</p>
            <div><a className={styles.primary} href="/login/demo?screen=profile">Sign in with local development account</a></div>
          </div>
        </>)}
      </main>
    </div>
    {kit && <QuickPreview title={kit.title} close={() => setKit(null)}
      action={<Link href={`/portal/kits/${kit.id}`} className={styles.iconButton} onClick={() => setKit(null)} aria-label="Open full Teaching Kit"><Icon name="expand" /></Link>}>
      <KitContents kit={kit} />
      <Link className={styles.textLink} href={`/portal/kits/${kit.id}`} onClick={() => setKit(null)}>Open full Teaching Kit <Icon name="expand" /></Link>
    </QuickPreview>}
  </div>;
}
