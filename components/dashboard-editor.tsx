"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useSyncExternalStore } from "react";
import { Brand } from "./brand";
import { ProfileCard } from "./profile-card";
import { SocialIcon } from "./social-icon";
import { defaultAppearance, type ProfileAppearance } from "@/lib/profile-appearance";
import { isCsaEvaluationForm } from "@/lib/evaluation-form";
import { services, type ProfileService } from "@/lib/profile-validation";

const sections = ["Profile", "Appearance", "Links"] as const;
const labels: Record<ProfileService, string> = { linkedin: "LinkedIn", instagram: "Instagram", facebook: "Facebook", github: "GitHub", youtube: "YouTube", tiktok: "TikTok", x: "X", website: "Website" };

const subscribeToOrigin = () => () => {};

async function profileMutation(path: string, options: RequestInit) {
  try {
    const response = await fetch(path, options);
    const result = await response.json().catch(() => ({})) as { error?: string; slug?: string };
    return { ok: response.ok, ...result };
  } catch {
    return { ok: false, error: "Check your connection and try again.", slug: undefined };
  }
}

export type DashboardData = {
  hasUnpublishedChanges: boolean;
  user: { name: string; email: string };
  profile: { displayName: string; role: string; bio: string; slug: string | null; accentColor: string; appearance: ProfileAppearance | null; evaluationUrl: string | null; studentNumber: string | null; showStudentNumber: boolean; status: string; avatarKey: string | null; backgroundKey: string | null };
  links: Array<{ service: string; url: string }>;
};

export function DashboardEditor({ initial }: { initial: DashboardData }) {
  const router = useRouter();
  const origin = useSyncExternalStore(subscribeToOrigin, () => window.location.origin, () => "");
  const permanentUrlInput = useRef<HTMLInputElement>(null);
  const [copyNotice, setCopyNotice] = useState("");
  const [section, setSection] = useState<(typeof sections)[number]>("Profile");
  const [name, setName] = useState(initial.profile.displayName);
  const [role, setRole] = useState(initial.profile.role);
  const [bio, setBio] = useState(initial.profile.bio);
  const [slug, setSlug] = useState(initial.profile.slug || "");
  const [claimedSlug, setClaimedSlug] = useState(initial.profile.slug);
  const permanentUrl = claimedSlug ? `${origin}/id/${claimedSlug}` : "";
  const [slugError, setSlugError] = useState("");
  const [color, setColor] = useState(initial.profile.accentColor);
  const [colorText, setColorText] = useState(initial.profile.accentColor);
  const [appearance, setAppearance] = useState(initial.profile.appearance);
  const { iconColor, cardColor, cardOpacity, frosted } = appearance ?? defaultAppearance;
  const [evaluationUrl, setEvaluationUrl] = useState(initial.profile.evaluationUrl || "");
  const [studentNumber, setStudentNumber] = useState(initial.profile.studentNumber || "");
  const [showStudentNumber, setShowStudentNumber] = useState(initial.profile.showStudentNumber);
  const usesCsaForm = !evaluationUrl.trim() || isCsaEvaluationForm(evaluationUrl);
  const [links, setLinks] = useState(initial.links.map((link) => ({ service: link.service as ProfileService, url: link.url })));
  const [notice, setNotice] = useState("Draft ready");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(initial.profile.status);
  const [avatarUrl, setAvatarUrl] = useState(initial.profile.avatarKey ? `/media/${initial.profile.avatarKey}` : "");
  const [backgroundUrl, setBackgroundUrl] = useState(initial.profile.backgroundKey ? `/media/${initial.profile.backgroundKey}` : "");
  const avatarInput = useRef<HTMLInputElement>(null);
  const backgroundInput = useRef<HTMLInputElement>(null);

  const userDisplayName = (initial.user.name && initial.user.name.trim().length > 0 && initial.user.name !== initial.user.email)
    ? initial.user.name
    : initial.user.email.split("@")[0];

  const userInitials = (
    userDisplayName
      .split(" ")
      .filter(Boolean)
      .map((part) => part[0])
      .slice(0, 2)
      .join("") || initial.user.email.slice(0, 2)
  ).toUpperCase();

  const payload = () => ({ displayName: name, role, bio, accentColor: color, appearance, evaluationUrl, studentNumber, showStudentNumber, links });

  async function copyPermanentUrl() {
    try {
      await navigator.clipboard.writeText(permanentUrl);
      setCopyNotice("Permanent URL copied.");
    } catch {
      permanentUrlInput.current?.focus();
      permanentUrlInput.current?.select();
      setCopyNotice("The URL is selected. Use your device’s Copy command.");
    }
  }

  async function save(showNotice = true) {
    setBusy(true); if (showNotice) setNotice("Saving draft…");
    const result = await profileMutation("/api/profile", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(payload()) });
    setBusy(false);
    if (!result.ok) { setNotice(result.error || "Draft could not be saved"); return false; }
    if (showNotice) { setNotice("Draft saved"); router.refresh(); }
    return true;
  }

  async function claim() {
    setBusy(true); setSlugError("");
    const result = await profileMutation("/api/profile/slug", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug }) });
    setBusy(false);
    if (!result.ok || !result.slug) return setSlugError(result.error || "Address could not be claimed");
    setClaimedSlug(result.slug); setSlug(result.slug); setNotice("Permanent address claimed");
  }

  async function publish() {
    if (!(await save(false))) return;
    setBusy(true); setNotice("Publishing profile…");
    const result = await profileMutation("/api/profile/publish", { method: "POST" });
    setBusy(false);
    if (!result.ok) return setNotice(result.error || "Profile could not be published");
    setNotice("Profile published");
    setStatus("published");
    router.refresh();
    if (result.slug) { setSlug(result.slug); setClaimedSlug(result.slug); }
  }

  async function unpublish() {
    setBusy(true); setNotice("Unpublishing profile…");
    const result = await profileMutation("/api/profile/unpublish", { method: "POST" });
    setBusy(false);
    if (!result.ok) return setNotice(result.error || "Profile could not be unpublished");
    setNotice("Profile unpublished");
    setStatus("draft");
    router.refresh();
  }

  async function upload(kind: "avatar" | "background", input: HTMLInputElement) {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    setBusy(true); setNotice(`Uploading ${kind}…`);
    const form = new FormData(); form.set("file", file);
    let response: Response;
    try { response = await fetch(`/api/uploads/${kind}`, { method: "POST", body: form }); } catch { setBusy(false); return setNotice("Upload failed. Check your connection."); }
    const result = await response.json().catch(() => ({})) as { error?: string; url?: string };
    setBusy(false);
    if (!response.ok) return setNotice(result.error || "Upload failed");
    if (result.url) (kind === "avatar" ? setAvatarUrl : setBackgroundUrl)(result.url);
    setNotice(`${kind === "avatar" ? "Photo" : "Background"} uploaded`);
    router.refresh();
  }

  async function deleteAccount() {
    if (!window.confirm("Delete your account? This removes your profile and images and cannot be undone. Your profile address stays reserved.")) return;
    setBusy(true); setNotice("Deleting account…");
    const result = await profileMutation("/api/account", { method: "DELETE" });
    if (!result.ok) { setBusy(false); return setNotice(result.error || "Account could not be deleted"); }
    router.push("/");
  }

  function addLink() {
    const service = services.find((candidate) => !links.some((link) => link.service === candidate));
    if (service) setLinks([...links, { service, url: "" }]);
  }

  return (
    <main className="dashboard">
      <header className="dashboardHeader">
        <Brand />
        {process.env.NODE_ENV === "development" && <Link className="textLink" href="/portal">Portal preview</Link>}
        <details className="dashboardAccountMenu">
          <summary aria-label="Open account menu" title={userDisplayName}>
            <span aria-hidden="true">{userInitials}</span>
          </summary>
          <div className="dashboardAccountPopover">
            <div className="accountCard">
              <span className="accountAvatar" aria-hidden="true">{userInitials}</span>
              <div className="accountInfo">
                <strong className="accountName" title={userDisplayName}>{userDisplayName}</strong>
                <small className="accountEmail" title={initial.user.email}>{initial.user.email}</small>
              </div>
            </div>
            <a className="logoutButton" href="/api/profile/export" download>Export my data</a>
            <button className="logoutButton logoutDanger" disabled={busy} type="button" onClick={deleteAccount}>Delete account</button>
            <form action="/logout" method="post" className="logoutForm"><button className="logoutButton" type="submit">Sign out</button></form>
          </div>
        </details>
      </header>
      <div className="dashboardBody" data-section={section}>
        <aside className="dashboardNav">
          <div>
            <p className="navLabel">Workspace</p>
            {sections.map((item) => (
              <button
                key={item}
                type="button"
                className={section === item ? "selected" : ""}
                aria-pressed={section === item}
                onClick={() => setSection(item)}
              >
                <span aria-hidden="true">{item.slice(0, 1)}</span>
                {item}
              </button>
            ))}
          </div>

          <div className="dashboardNavFooter">
            <div className="accountCard">
              <span className="accountAvatar" aria-hidden="true">{userInitials}</span>
              <div className="accountInfo">
                <strong className="accountName" title={userDisplayName}>{userDisplayName}</strong>
                <small className="accountEmail" title={initial.user.email}>{initial.user.email}</small>
              </div>
            </div>
            <a className="logoutButton" href="/api/profile/export" download>Export my data</a>
            <button className="logoutButton logoutDanger" disabled={busy} type="button" onClick={deleteAccount}>Delete account</button>
            <form action="/logout" method="post" className="logoutForm">
              <button className="logoutButton" type="submit" aria-label="Sign out">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
                <span>Sign out</span>
              </button>
            </form>
          </div>
        </aside>
        <section className="editorPane">
          <div className="editorHeading"><div><h1>{section}</h1><p className="headingContext">{status === "suspended" ? "A Suspended Profile cannot be published." : "Edits stay in your Draft Profile until you publish. Public updates can take up to 60 seconds."}</p></div><span className="statusBadge">{status === "published" ? "Published Profile" : status === "suspended" ? "Suspended Profile" : "Draft Profile"}</span></div>

          {section === "Profile" && <div className="formStack">
            <div className="uploadRow"><div className="avatar avatarSmall" style={avatarUrl ? { backgroundImage: `url(${avatarUrl})`, backgroundSize: "cover" } : undefined}>{avatarUrl ? "" : name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</div><div><input ref={avatarInput} hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => upload("avatar", event.target)} /><button className="buttonSecondary buttonSmall" type="button" onClick={() => avatarInput.current?.click()}>Choose photo</button><p>JPEG, PNG, or WebP. Up to 2 MB.</p></div></div>
            <label className="field">Display name<input value={name} maxLength={128} onChange={(event) => setName(event.target.value)} /></label>
            <label className="field">Role or title<input value={role} maxLength={128} onChange={(event) => setRole(event.target.value)} /></label>
            <label className="field">Short bio<textarea value={bio} maxLength={500} rows={4} onChange={(event) => setBio(event.target.value)} /><span>{bio.length}/500</span></label>
            <label className="field">Evaluation form URL<input type="url" value={evaluationUrl} placeholder="CSA evaluation form" onChange={(event) => setEvaluationUrl(event.target.value)} /><small>Leave blank to use the CSA evaluation form.</small></label>
            <div className="studentNumberSettings">
              <label className="field">
                Your student number
                <input type="text" inputMode="numeric" autoComplete="off" maxLength={32} value={studentNumber} onChange={(event) => setStudentNumber(event.target.value)} />
                {usesCsaForm && <small>Required for CSA evaluation prefill. Use Last Name, First Name for your display name.</small>}
              </label>
              <label className="studentNumberVisibility">
                <input type="checkbox" checked={showStudentNumber} onChange={(event) => setShowStudentNumber(event.target.checked)} />
                <span>Show student number on my public profile card<small>{usesCsaForm ? "When you publish with the CSA evaluation form, visitors can see your student number in the form and in the public page source, even if this setting is off." : "Applies when you publish."}</small></span>
              </label>
            </div>
            <div className="field">
              <label htmlFor="profile-address">{claimedSlug ? "Permanent URL for your NFC Card" : "Choose your permanent Slug"}</label>
              <div className={claimedSlug ? "permanentUrl" : "slugField"}>
                {claimedSlug ? (
                  <>
                    <input id="profile-address" ref={permanentUrlInput} value={permanentUrl} readOnly />
                    <button className="buttonSecondary buttonSmall" type="button" disabled={!origin} onClick={copyPermanentUrl}>Copy URL</button>
                  </>
                ) : (
                  <>
                    <span aria-hidden="true">/id/</span>
                    <input id="profile-address" value={slug} maxLength={64} aria-label="Profile slug" onChange={(event) => setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} />
                    <button className="buttonSecondary buttonSmall" disabled={busy || slug.length < 3} type="button" onClick={claim}>Claim address</button>
                  </>
                )}
              </div>
              <small role={slugError ? "alert" : undefined}>{slugError || (claimedSlug ? "Program this URL into your NFC Card. The URL stays the same when you publish updates." : "Your Slug becomes part of the URL you program into your NFC Card. It cannot change after you claim it.")}</small>
              <small aria-live="polite">{copyNotice}</small>
            </div>
          </div>}

          {section === "Appearance" && <div className="formStack">
            <div className="backgroundUpload"><div><strong>Background image</strong><p>JPEG, PNG, or WebP. Up to 4 MB.</p></div><input ref={backgroundInput} hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => upload("background", event.target)} /><button className="buttonSecondary buttonSmall" type="button" onClick={() => backgroundInput.current?.click()}>Choose background</button></div>
            <fieldset className="appearanceControls">
              <legend>Profile colors</legend>
              <div className="appearanceColors">
                <div className="appearanceColor">
                  <label htmlFor="profile-button-color">Button color</label>
                  <span>
                    <input id="profile-button-color" type="color" value={color} onChange={(event) => {
                      setColor(event.target.value);
                      setColorText(event.target.value);
                    }} />
                    <input className="colorHex" aria-label="Button color hex value" value={colorText} maxLength={7} spellCheck={false} onBlur={() => setColorText(color)} onChange={(event) => {
                      setColorText(event.target.value);
                      if (/^#[0-9a-f]{6}$/i.test(event.target.value)) setColor(event.target.value);
                    }} />
                  </span>
                </div>
                <label className="appearanceColor">Social icon color
                  <span><input type="color" value={iconColor} onChange={(event) => setAppearance({ ...defaultAppearance, ...appearance, iconColor: event.target.value })} />{iconColor.toUpperCase()}<SocialIcon platform="website" style={{ color: iconColor }} /></span>
                </label>
                <label className="appearanceColor">Card color
                  <span><input type="color" value={cardColor} onChange={(event) => setAppearance({ ...defaultAppearance, ...appearance, cardColor: event.target.value })} />{cardColor.toUpperCase()}</span>
                </label>
              </div>
            </fieldset>
            <fieldset className="appearanceControls">
              <legend>Card finish</legend>
              <label className="appearanceOpacity" htmlFor="profile-card-opacity">
                <span>Card opacity <output aria-hidden="true">{cardOpacity}%</output></span>
                <input id="profile-card-opacity" type="range" min={70} max={100} value={cardOpacity} aria-valuetext={`${cardOpacity}%`} onChange={(event) => setAppearance({ ...defaultAppearance, ...appearance, cardOpacity: event.target.valueAsNumber })} />
              </label>
              <label className="appearanceFrost">
                <input type="checkbox" checked={frosted} onChange={(event) => {
                  const checked = event.target.checked;
                  setAppearance({ ...defaultAppearance, ...appearance, frosted: checked, cardOpacity: checked && cardOpacity === 100 ? 78 : cardOpacity });
                }} />
                <span>Frosted glass<small>Blurs the background behind the card.</small></span>
              </label>
            </fieldset>
            <div className="appearanceActions">
              {appearance && <button type="button" className="buttonSecondary buttonSmall" onClick={() => setAppearance(null)}>Reset card styles</button>}
              <a className="appearancePreviewLink" href="#profile-preview">View live preview</a>
            </div>
          </div>}

          {section === "Links" && <div className="formStack linksForm">
            <p className="sectionIntro">Add up to eight HTTPS links. Each platform can appear once.</p>
            {links.map((link, index) => <div className="linkRow" key={`${link.service}-${index}`}><span className="dragHandle">{index + 1}</span><div><select value={link.service} aria-label={`Link ${index + 1} platform`} onChange={(event) => setLinks(links.map((item, itemIndex) => itemIndex === index ? { ...item, service: event.target.value as ProfileService } : item))}>{services.map((service) => <option key={service} value={service} disabled={links.some((item, itemIndex) => itemIndex !== index && item.service === service)}>{labels[service]}</option>)}</select><input type="url" value={link.url} placeholder={`https://${link.service}.com/…`} aria-label={`${labels[link.service]} URL`} onChange={(event) => setLinks(links.map((item, itemIndex) => itemIndex === index ? { ...item, url: event.target.value } : item))} /></div><button type="button" aria-label={`Remove ${labels[link.service]}`} onClick={() => setLinks(links.filter((_, itemIndex) => itemIndex !== index))}>Remove</button></div>)}
            <button className="buttonSecondary addLink" disabled={links.length >= services.length} type="button" onClick={addLink}>Add social link</button>
          </div>}
        </section>
        <aside className="previewPane" id="profile-preview" aria-label="Draft Profile preview">
          <div className="previewHeader">
            <div><p>Draft Profile preview</p><span>Mobile</span></div>
            {status === "published" && claimedSlug && (
              <Link className="previewOpen" href={`/id/${claimedSlug}`}>
                Open Published Profile
              </Link>
            )}
          </div>
          <div className="phoneFrame"><div className="phoneTop"><span /></div><ProfileCard compact name={name || "Your name"} role={role} bio={bio} studentNumber={showStudentNumber ? studentNumber.trim() : undefined} primary={color} avatarUrl={avatarUrl} coverUrl={backgroundUrl} appearance={appearance} socialLinks={links.filter((link) => link.url.trim()).map(({ service }) => ({ service, label: labels[service] }))} /></div>
        </aside>
      </div>
      <footer className="dashboardFooter" aria-label="Profile actions">
        <div className="dashboardActions">
          {status === "published" && claimedSlug && <Link className="buttonSecondary buttonSmall" href={`/id/${claimedSlug}`}>View Published Profile</Link>}
          <button className="buttonSecondary buttonSmall" disabled={busy} type="button" onClick={() => save()}>Save draft</button>
          <button className="button buttonSmall" disabled={busy || status === "suspended"} type="button" onClick={publish}>
            <span className="publishLabelFull">{status === "published" ? "Publish changes" : "Publish profile"}</span>
            <span className="publishLabelCompact">Publish</span>
          </button>
          {status === "published" && <button className="buttonSecondary buttonSmall dashboardUnpublish" disabled={busy} type="button" onClick={unpublish}>Unpublish</button>}
        </div>
        <div className="profileSaveStatus">
          {status === "published" && initial.hasUnpublishedChanges && <strong>Saved Draft Profile changes have not been published.</strong>}
          <span className="saveState" role="status">{notice}</span>
        </div>
      </footer>
    </main>
  );
}
