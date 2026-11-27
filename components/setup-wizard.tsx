"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { profileMutation, type DashboardData } from "./dashboard-editor";
import { ProfileCard } from "./profile-card";
import styles from "./portal/portal.module.css";
import { isCsaEvaluationForm } from "@/lib/evaluation-form";

const steps = ["Name and role", "Student number", "Photo", "Permanent Slug", "Preview and publish"] as const;

/** Walks a new User from an empty Draft Profile to a Published Profile. Every step saves through the dashboard's routes. */
export function SetupWizard({ initial }: { initial: DashboardData }) {
  const { profile } = initial;
  const [step, setStep] = useState(profile.slug ? 4 : 0);
  const [name, setName] = useState(profile.displayName);
  const [roleTitle, setRoleTitle] = useState(profile.roleTitle);
  const [studentNumber, setStudentNumber] = useState(profile.studentNumber || "");
  const [showStudentNumber, setShowStudentNumber] = useState(profile.showStudentNumber);
  const [avatarUrl, setAvatarUrl] = useState(profile.avatarKey ? `/media/${profile.avatarKey}` : "");
  const [slug, setSlug] = useState(profile.slug || "");
  const [claimedSlug, setClaimedSlug] = useState(profile.slug);
  const [published, setPublished] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const avatarInput = useRef<HTMLInputElement>(null);
  const usesCsaForm = !profile.evaluationUrl || isCsaEvaluationForm(profile.evaluationUrl);

  function go(next: number) { setMessage(""); setStep(next); }

  async function saveDraft() {
    if (!name.trim() || !roleTitle.trim()) { setMessage("Enter your display name and role."); return false; }
    setBusy(true); setMessage("Saving draft…");
    const result = await profileMutation("/api/profile", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: name, roleTitle, bio: profile.bio, accentColor: profile.accentColor, appearance: profile.appearance, evaluationUrl: profile.evaluationUrl || "", studentNumber, showStudentNumber, links: initial.links }),
    });
    setBusy(false);
    setMessage(result.ok ? "" : result.error || "Draft could not be saved");
    return result.ok;
  }

  async function saveAndContinue() {
    if (await saveDraft()) go(step + 1);
  }

  async function upload(input: HTMLInputElement) {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    setBusy(true); setMessage("Uploading photo…");
    const form = new FormData(); form.set("file", file);
    let response: Response;
    try { response = await fetch("/api/uploads/avatar", { method: "POST", body: form }); } catch { setBusy(false); return setMessage("Upload failed. Check your connection."); }
    const result = await response.json().catch(() => ({})) as { error?: string; url?: string };
    setBusy(false);
    if (!response.ok) return setMessage(result.error || "Upload failed");
    if (result.url) setAvatarUrl(result.url);
    setMessage("Photo uploaded");
  }

  async function claim() {
    setBusy(true); setMessage("");
    const result = await profileMutation("/api/profile/slug", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug }) });
    setBusy(false);
    if (!result.ok || !result.slug) return setMessage(result.error || "Slug could not be claimed");
    setClaimedSlug(result.slug); setSlug(result.slug); go(4);
  }

  async function publish() {
    setBusy(true); setMessage("Publishing profile…");
    const result = await profileMutation("/api/profile/publish", { method: "POST" });
    setBusy(false);
    if (!result.ok) return setMessage(result.error || "Profile could not be published");
    setPublished(true); setMessage("Profile published");
  }

  const permanentUrl = claimedSlug ? `${initial.profileOrigin}/id/${claimedSlug}` : "";

  return (
    <div className={styles.profileEditor}>
      <header className={styles.pageHeading}>
        <div>
          <h1>Set up your Profile</h1>
          <p>Step {step + 1} of {steps.length}: {steps[step]}</p>
        </div>
        {!published && <Link className={styles.secondary} href="/dashboard">Skip for now</Link>}
      </header>
      <div className={styles.profilePanels}>
        <section className={styles.profileFields} aria-label={steps[step]}>
          {published ? <div className="formStack">
            <h2>Your Profile is published</h2>
            <p>Program this URL into your NFC Card: <strong>{permanentUrl}</strong></p>
            <div className={styles.flex}>
              <Link className={styles.button} href={`/id/${claimedSlug}`}>Open Published Profile</Link>
              <Link className={styles.secondary} href="/dashboard">Go to dashboard</Link>
            </div>
          </div> : <div className="formStack">
            {step === 0 && <>
              <label className="field">Display name<input value={name} maxLength={128} onChange={(event) => setName(event.target.value)} />{usesCsaForm && <small>Use Last Name, First Name. The CSA evaluation form is filled in with this name.</small>}</label>
              <label className="field">Role or title<input value={roleTitle} maxLength={128} placeholder="Peer Adviser" onChange={(event) => setRoleTitle(event.target.value)} /></label>
            </>}
            {step === 1 && <div className="studentNumberSettings">
              <label className="field">
                Your student number
                <input type="text" inputMode="numeric" autoComplete="off" maxLength={32} value={studentNumber} onChange={(event) => setStudentNumber(event.target.value)} />
                <small>Your student number fills in the CSA evaluation form, so students you advise do not have to type it.</small>
              </label>
              <label className="studentNumberVisibility">
                <input type="checkbox" checked={showStudentNumber} onChange={(event) => setShowStudentNumber(event.target.checked)} />
                <span>Show student number on my public profile card<small>When you publish with the CSA evaluation form, visitors can see your student number in the form and in the public page source, even if this setting is off.</small></span>
              </label>
            </div>}
            {step === 2 && <div className="uploadRow">
              <div className="avatar avatarSmall" style={avatarUrl ? { backgroundImage: `url(${avatarUrl})`, backgroundSize: "cover" } : undefined}>{avatarUrl ? "" : name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</div>
              <div>
                <input ref={avatarInput} hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => upload(event.target)} />
                <button className={styles.secondary} disabled={busy} type="button" onClick={() => avatarInput.current?.click()}>Choose photo</button>
                <p>JPEG, PNG, or WebP. Up to 2 MB. You can add a photo later.</p>
              </div>
            </div>}
            {step === 3 && <div className="field">
              <label htmlFor="setup-slug">Choose your permanent Slug</label>
              <div className="slugField">
                <span aria-hidden="true">/id/</span>
                <input id="setup-slug" value={slug} maxLength={64} aria-label="Profile slug" onChange={(event) => setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} />
                <button className={styles.secondary} disabled={busy || slug.length < 3} type="button" onClick={claim}>Claim address</button>
              </div>
              <small><strong>Your Slug is permanent.</strong> It becomes part of the URL you program into your NFC Card and cannot change after you claim it.</small>
            </div>}
            {step === 4 && <>
              <p>This is how your Profile will look. Publishing makes it visible at <strong>{permanentUrl}</strong>.</p>
              {usesCsaForm && <p>Your Profile links to the CSA evaluation form, filled in with your name and student number. You can set a different form on the dashboard.</p>}
            </>}
          </div>}
          <p role="status">{message}</p>
          {!published && <div className={styles.flex}>
            {step > 0 && <button className={styles.secondary} disabled={busy} type="button" onClick={() => go(step === 4 ? 2 : step - 1)}>Back</button>}
            {step < 2 && <button className={styles.button} disabled={busy} type="button" onClick={saveAndContinue}>Save and continue</button>}
            {step === 2 && <button className={styles.button} disabled={busy} type="button" onClick={() => go(claimedSlug ? 4 : 3)}>{avatarUrl ? "Continue" : "Continue without a photo"}</button>}
            {step === 4 && <button className={styles.button} disabled={busy} type="button" onClick={publish}>Publish profile</button>}
          </div>}
        </section>
        <aside className={styles.profilePreview} aria-label="Draft Profile preview">
          <div className="previewHeader"><h2>Draft Profile preview</h2></div>
          <div className="phoneFrame"><div className="phoneTop"><span /></div><ProfileCard compact name={name || "Your name"} roleTitle={roleTitle} bio={profile.bio} studentNumber={showStudentNumber ? studentNumber.trim() : undefined} primary={profile.accentColor} avatarUrl={avatarUrl} coverUrl={profile.backgroundKey ? `/media/${profile.backgroundKey}` : undefined} appearance={profile.appearance} socialLinks={[]} /></div>
        </aside>
      </div>
    </div>
  );
}
