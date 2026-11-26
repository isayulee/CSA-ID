"use client";

import { useRef, useState, type FormEvent } from "react";
import styles from "./portal.module.css";

type Candidate = { id: string; name: string };
type ApprovedPeerAdviser = Candidate & { campus: string; position: string; order: number };
type Campus = { id: string; name: string };

export type ApprovalAction =
  | { type: "approve"; userId: string; campusId: string }
  | { type: "update"; userId: string; campusId: string; position: string; order: number }
  | { type: "revoke"; userId: string; reason: string };

type Props = {
  candidates: Candidate[];
  advisers: ApprovedPeerAdviser[];
  campuses: Campus[];
  onAction: (action: ApprovalAction) => string | Promise<string>;
};

export function PeerAdviserApprovals({ candidates, advisers, campuses, onAction }: Props) {
  const submitting = useRef(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function submit(action: ApprovalAction) {
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    setNotice("");
    setError("");
    try {
      setNotice(await onAction(action));
    } catch {
      setError("The change could not be saved. Try again.");
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  function update(event: FormEvent<HTMLFormElement>, userId: string) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const revoke = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value") === "revoke";
    setNotice("");
    setError("");
    if (revoke) {
      const reason = String(fields.get("reason") ?? "").trim();
      if (!reason) { setError("Give a reason before revoking approval."); return; }
      void submit({ type: "revoke", userId, reason });
      return;
    }

    const position = String(fields.get("position") ?? "").trim();
    const order = Number(fields.get("order"));
    if (position && (!Number.isInteger(order) || order < 1 || order > 99)) {
      setError("Enter a Directory order from 1 to 99 for an Officer.");
      return;
    }
    void submit({
      type: "update", userId, campusId: String(fields.get("campus")), position, order: position ? order : 0,
    });
  }

  function campusField(initialCampus?: string) {
    return <label className={styles.field}>Campus
      <select name="campus" defaultValue={initialCampus} required>
        {campuses.map((campus) => <option key={campus.id} value={campus.id}>{campus.name}</option>)}
      </select>
    </label>;
  }

  return <>
    <header className={styles.pageHeading}><div><h1>Peer Adviser approvals</h1><p>Approve Peer Advisers and manage Campus and Officer positions.</p></div></header>
    <p role="status">{pending ? "Saving changes…" : notice}</p>
    <p role="alert" className={styles.error}>{error}</p>
    <div className={styles.stack}>
      <h2>Awaiting approval</h2>
      {candidates.length === 0 && <p className={styles.panel}>No Users awaiting approval.</p>}
      {candidates.map((person) => <form className={styles.panel} key={person.id} onSubmit={(event) => {
        event.preventDefault();
        const campusId = String(new FormData(event.currentTarget).get("campus"));
        void submit({ type: "approve", userId: person.id, campusId });
      }}>
        <fieldset className={`${styles.fieldset} ${styles.flex}`} disabled={pending}>
          <legend>{person.name}</legend>
          {campusField()}
          <button className={styles.button} disabled={campuses.length === 0}>Approve {person.name}</button>
        </fieldset>
      </form>)}
      <h2>Approved Peer Advisers</h2>
      {advisers.length === 0 && <p className={styles.panel}>No approved Peer Advisers.</p>}
      {advisers.map((adviser) => <form key={adviser.id} className={styles.panel} onSubmit={(event) => update(event, adviser.id)}>
        <fieldset className={`${styles.fieldset} ${styles.stack}`} disabled={pending}>
          <legend>{adviser.name}</legend>
          <div className={styles.formGrid}>
            {campusField(adviser.campus)}
            <label className={styles.field}>Officer position<input name="position" defaultValue={adviser.position} maxLength={64} /></label>
            <label className={styles.field}>Directory order<input name="order" type="number" min={1} max={99} defaultValue={adviser.order || ""} /></label>
          </div>
          <div><button className={styles.button} value="save" disabled={campuses.length === 0}>Save changes</button></div>
          <details><summary>Revoke approval</summary><div className={styles.stack}>
            <label className={styles.field}>Reason for revocation<input name="reason" maxLength={1000} /></label>
            <div><button className={styles.secondary} value="revoke" formNoValidate>Revoke approval for {adviser.name}</button></div>
          </div></details>
        </fieldset>
      </form>)}
    </div>
  </>;
}
