"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { academicTerm, courses, peerId, updatePreview, type Kit, type KitDraft, type PreviewState } from "./model";
import styles from "./portal.module.css";

const allowedLinkHosts = ["drive.google.com", "docs.google.com", "www.youtube.com", "youtu.be"];
function validMaterialLink(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && allowedLinkHosts.includes(url.hostname);
  } catch { return false; }
}

function KitDraftDialog({ kit, draft, availableCourses }: {
  kit?: Kit;
  draft?: KitDraft;
  availableCourses: typeof courses;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const initial = draft ?? kit;

  useEffect(() => { dialog.current?.showModal(); }, []);
  function close() { router.replace(initial ? `/portal/kits/${initial.id}` : "/portal/kits"); }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const fields = new FormData(event.currentTarget);
    const title = String(fields.get("title")).trim();
    const body = String(fields.get("body")).trim();
    const link = String(fields.get("link")).trim();
    if (!title) { setError("Enter a Teaching Kit title."); return; }
    if (link && !validMaterialLink(link)) { setError("Use an HTTPS link from Google Drive or YouTube."); return; }
    setError("");
    setSaving(true);
    try {
      const file = fields.get("pdf");
      let pdf = initial?.pdf ?? "";
      if (file instanceof File && file.size > 0) {
        if (file.size > 5 * 1024 * 1024 || await file.slice(0, 5).text() !== "%PDF-") {
          setError("Choose a PDF of 5 MiB or less."); return;
        }
        pdf = file.name;
      }
      if (!body && !link && !pdf) { setError("Add notes, a link, or a PDF to the Kit Draft."); return; }
      updatePreview((state) => {
        const course = initial?.course ?? String(fields.get("course"));
        const year = initial?.year ?? Number(fields.get("year"));
        const term = initial?.term ?? Number(fields.get("term"));
        const existingKit = state.kits.find((item) => item.course === course && item.year === year && item.term === term);
        const pending = state.drafts.find((item) => item.course === course && item.year === year && item.term === term && item.author === peerId && item.state === "pending");
        const next: KitDraft = {
          id: existingKit?.id ?? pending?.id ?? initial?.id ?? crypto.randomUUID(),
          course, year, term, title, body, link, pdf, author: peerId, state: "pending", note: "",
          base: pending?.base ?? existingKit?.revision ?? existingKit?.id ?? "",
        };
        return { ...state, drafts: [...state.drafts.filter((item) => item !== pending), next] };
      });
      router.replace("/portal/kits");
    } catch {
      setError("The PDF could not be read. Choose it again.");
    } finally {
      setSaving(false);
    }
  }

  return <dialog className={styles.kitDialog} ref={dialog} aria-labelledby="kit-draft-heading" onClose={close} onCancel={(event) => { event.preventDefault(); close(); }}>
    <header><h2 id="kit-draft-heading">{initial ? "Edit Kit Draft" : "Add a Teaching Kit"}</h2><p>Your Kit Draft goes to an Administrator for review.</p></header>
    <button className={styles.close} type="button" aria-label="Close Kit Draft" onClick={close}>×</button>
    <form className={styles.stack} onSubmit={submit}>
      <label className={styles.field}>Title<input name="title" required maxLength={128} defaultValue={initial?.title} /></label>
      {initial ? <small>{initial.course} · {academicTerm(initial.year, initial.term)}</small> :
        <div className={styles.formGrid}>
          <label className={styles.field}>Course<select name="course" required>{availableCourses.map((course) => <option value={course.code} key={course.code}>{course.code} · {course.title}</option>)}</select></label>
          <label className={styles.field}>Academic year starts<input name="year" required type="number" min={2000} max={2100} defaultValue={2026} /></label>
          <label className={styles.field}>Term<select name="term">{[1, 2, 3, 4].map((term) => <option key={term}>{term}</option>)}</select></label>
        </div>}
      <label className={styles.field}>Teaching notes<textarea name="body" rows={5} maxLength={20000} defaultValue={initial?.body} /></label>
      <label className={styles.field}>Google Drive or YouTube URL<input name="link" type="url" maxLength={500} defaultValue={initial?.link} /></label>
      <label className={`${styles.field} ${styles.attachment}`}>
        <strong>PDF attachment</strong>
        <input name="pdf" type="file" accept="application/pdf,.pdf" />
        <small>{initial?.pdf ? `Selected: ${initial.pdf}. ` : ""}Up to 5 MiB. The local preview keeps the file name.</small>
      </label>
      <p role="alert" className={styles.error}>{error}</p>
      <div className={styles.flex}>
        <button className={styles.secondary} type="button" onClick={close}>Cancel</button>
        <button className={styles.button} disabled={saving}>{saving ? "Checking draft…" : "Submit Kit Draft"}</button>
      </div>
    </form>
  </dialog>;
}

export function TeachingKits({ state, kitId, edit }: { state: PreviewState; kitId?: string; edit?: boolean }) {
  const [course, setCourse] = useState("");
  const [term, setTerm] = useState("");
  const [query, setQuery] = useState("");
  const [draftView, setDraftView] = useState(false);
  const availableCourses = [...courses, ...(state.addedCourses ?? [])];
  const kit = state.kits.find((item) => item.id === kitId);
  const draft = state.drafts.find((item) => item.id === kitId && item.author === peerId && item.state === "pending");
  const terms = [...new Set(state.kits.map((item) => academicTerm(item.year, item.term)))];
  const visibleKits = state.kits.filter((item) =>
    (!course || item.course === course) && (!term || academicTerm(item.year, item.term) === term) &&
    `${item.title} ${item.course} ${item.body}`.toLowerCase().includes(query.trim().toLowerCase())
  );
  const ownDrafts = state.drafts.filter((item) => item.author === peerId && item.state !== "approved");
  const isApprovedPeerAdviser = state.advisers.some((person) => person.id === peerId);
  return <>
    <header className={styles.pageHeading}>
      <div><h1>{kit?.title ?? draft?.title ?? "Teaching Kits"}</h1><p>{kit ? `${kit.course} · ${academicTerm(kit.year, kit.term)}` : "Find approved study materials by Course and academic term."}</p></div>
      {kitId && kitId !== "new" ? <Link className={styles.secondary} href="/portal/kits">All Teaching Kits</Link>
        : isApprovedPeerAdviser && <Link className={styles.button} href="/portal/kits/new">Add a Teaching Kit</Link>}
    </header>
    {kit ? <article className={`${styles.panel} ${styles.stack}`}>
      <span className={styles.badge} data-status="approved">Approved</span>
      {kit.body && <p className={styles.materialBody}>{kit.body}</p>}
      {kit.link && validMaterialLink(kit.link) && <a href={kit.link} target="_blank" rel="noreferrer">Open teaching material in a new tab</a>}
      {kit.pdf && <small>Sample attachment: {kit.pdf}</small>}
      {draft && <p>Your Kit Draft is pending review. This approved version is still available.</p>}
      {isApprovedPeerAdviser && <div><Link className={styles.secondary} href={`/portal/kits/${kit.id}/edit`}>{draft ? "Edit Kit Draft" : "Propose changes"}</Link></div>}
    </article> : kitId && kitId !== "new" ? (
      <div className={styles.panel}>{draft ? <><p>This Kit Draft is pending review.</p><Link href={`/portal/kits/${draft.id}/edit`}>Edit Kit Draft</Link></> : <p>Teaching Kit unavailable.</p>}</div>
    ) : <>
      <div className={styles.tabs} aria-label="Teaching Kit views">
        <button type="button" aria-pressed={!draftView} onClick={() => setDraftView(false)}>Approved Teaching Kits</button>
        <button type="button" aria-pressed={draftView} onClick={() => setDraftView(true)}>My Kit Drafts ({ownDrafts.length})</button>
      </div>
      {draftView ? <div className={styles.stack}>
        {ownDrafts.length === 0 && <p className={styles.panel}>You have no Kit Drafts.</p>}
        {ownDrafts.map((item, index) => <article className={styles.panel} key={`${item.id}-${index}`}>
          <span className={styles.badge} data-status={item.state}>{item.state === "pending" ? "Pending review" : "Rejected"}</span>
          <h2>{item.title}</h2><p>{item.course} · {academicTerm(item.year, item.term)}</p>
          {item.state === "pending" ? <Link href={`/portal/kits/${item.id}/edit`}>Edit Kit Draft</Link> : <p>Review note: {item.note}</p>}
        </article>)}
      </div> : <>
        <div className={styles.filters} aria-label="Teaching Kit filters">
          <label className={styles.field}>Search Teaching Kits<input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Title, Course, or topic" /></label>
          <label className={styles.field}>Course<select value={course} onChange={(e) => setCourse(e.target.value)}><option value="">All Courses</option>{availableCourses.map((item) => <option key={item.code} value={item.code}>{item.code} · {item.title}</option>)}</select></label>
          <label className={styles.field}>Academic term<select value={term} onChange={(e) => setTerm(e.target.value)}><option value="">All terms</option>{terms.map((item) => <option key={item}>{item}</option>)}</select></label>
        </div>
        {visibleKits.length === 0 && <p className={styles.panel} role="status">No approved Teaching Kits match your filters.</p>}
        <div className={`${styles.kitsGrid} ${styles.libraryGrid}`}>{visibleKits.map((item, index) => (
          <Link key={item.id} href={`/portal/kits/${item.id}`} className={styles.kitTile} data-tone={index % 3}>
            <span className={styles.badge}>{item.course}</span><div><h3>{item.title}</h3><small>{academicTerm(item.year, item.term)}</small></div>
          </Link>
        ))}</div>
      </>}
    </>}
    {edit && isApprovedPeerAdviser && (kit || draft || kitId === "new") && <KitDraftDialog key={kitId} kit={kit} draft={draft} availableCourses={availableCourses} />}
  </>;
}

export function KitReviews({ drafts, approvedKits }: {
  drafts: readonly KitDraft[];
  approvedKits: readonly Kit[];
}) {
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const pending = drafts.filter((item) => item.state === "pending");

  function review(event: FormEvent<HTMLFormElement>, draft: KitDraft) {
    event.preventDefault();
    setNotice("");
    setError("");
    const reject = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value") === "reject";
    const note = String(new FormData(event.currentTarget).get("note") ?? "").trim();
    if (reject && !note) { setError("Enter a review note before rejecting the Kit Draft."); return; }
    updatePreview((state) => ({
      ...state,
      drafts: state.drafts.map((item) => item === draft ? { ...item, state: reject ? "rejected" : "approved", note } : item),
      kits: reject ? state.kits : [
        ...state.kits.filter((item) => item.id !== draft.id),
        { id: draft.id, course: draft.course, year: draft.year, term: draft.term, title: draft.title, body: draft.body, link: draft.link, pdf: draft.pdf, revision: crypto.randomUUID() },
      ],
    }));
    setNotice(reject ? "Kit Draft rejected." : "Kit Draft approved. The new version is now available in the preview.");
  }

  return <>
    <header className={styles.pageHeading}><div><h1>Kit Draft reviews</h1><p>Review proposed Teaching Kit versions before making them available.</p></div></header>
    <p role="status">{notice}</p>
    <p role="alert" className={styles.error}>{error}</p>
    {pending.length === 0 && <p className={styles.panel}>No Kit Drafts are waiting for review.</p>}
    <div className={styles.stack}>{pending.map((draft) => {
      const approved = approvedKits.find((kit) => kit.id === draft.id);
      const approvedVersion = approved?.revision ?? approved?.id ?? "";
      const isStale = approvedVersion !== draft.base;
      return <form key={`${draft.id}-${draft.author}`} className={`${styles.panel} ${styles.stack}`} onSubmit={(e) => review(e, draft)}>
      <span className={styles.badge} data-status="pending">Pending review</span><h2>{draft.title}</h2>
      <small>{draft.course} · {academicTerm(draft.year, draft.term)}</small>
      <p className={styles.materialBody}>{draft.body}</p>
      {draft.link && validMaterialLink(draft.link) && <a href={draft.link} target="_blank" rel="noreferrer">Review linked material in a new tab</a>}
      {draft.pdf && <small>Sample attachment: {draft.pdf}</small>}
      {isStale && <p><strong>Older version.</strong> Approving this Kit Draft will replace the current approved version.</p>}
      {approved && <Link href={`/portal/kits/${draft.id}`}>Compare with the approved Teaching Kit</Link>}
      <label className={styles.field}>Review note (required for rejection)<textarea name="note" maxLength={1000} rows={2} /></label>
      <div className={styles.flex}><button className={styles.button} value="approve">Approve Kit Draft</button><button className={styles.secondary} value="reject">Reject Kit Draft</button></div>
      </form>;
    })}</div>
  </>;
}
