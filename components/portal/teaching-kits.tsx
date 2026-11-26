"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { academicTerm, peerId, updatePreview, type Course, type Kit, type KitDraft } from "./model";
import styles from "./portal.module.css";

const allowedLinkHosts = ["drive.google.com", "docs.google.com", "www.youtube.com", "youtu.be"];
export function validMaterialLink(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && allowedLinkHosts.includes(url.hostname);
  } catch { return false; }
}

export function KitDraftDialog({ kit, draft, availableCourses }: {
  kit?: Kit;
  draft?: KitDraft;
  availableCourses: readonly Course[];
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
