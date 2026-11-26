import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { EvaluationPrefill } from "@/components/evaluation-prefill";
import { MapuaSquares } from "@/components/mapua-squares";
import { SocialIcon, type SocialPlatform } from "@/components/social-icon";
import { getDb } from "@/lib/db";
import { evaluationFormUrl, isCsaEvaluationForm } from "@/lib/evaluation-form";
import { appearanceOf, profileAccentStyle, profileAppearanceStyle } from "@/lib/profile-appearance";
import { loadPublishedProfile } from "@/lib/public/published-profile";

// Profiles stay dynamic; the Worker caches only complete HTML documents.
export const dynamic = "force-dynamic";
export const metadata = { title: "Mapúa CSA Profile", robots: { index: false, follow: false } };

const demo = {
  profileId: "demo", slug: "demo", displayName: "Alex Santos", roleTitle: "Peer Adviser", bio: "Peer Adviser for tutoring sessions at the Center for Student Advising.", accentColor: "#B5121B", iconColor: null, cardColor: null, cardOpacity: null, cardFrosted: null, avatarKey: null, backgroundKey: null, evaluationUrl: evaluationFormUrl, studentNumber: null, showStudentNumber: false,
  links: [
    { service: "linkedin", url: "https://linkedin.com" }, { service: "instagram", url: "https://instagram.com" }, { service: "facebook", url: "https://facebook.com" }, { service: "github", url: "https://github.com" }, { service: "website", url: "https://example.com" },
  ],
};
const labels: Record<string, string> = { linkedin: "LinkedIn", instagram: "Instagram", facebook: "Facebook", github: "GitHub", youtube: "YouTube", tiktok: "TikTok", x: "X", website: "Website" };

async function loadProfile(slug: string) {
  if (slug === "demo") return demo;
  return loadPublishedProfile(getDb(), slug);
}

export default async function PublicProfilePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const profile = await loadProfile(slug);
  if (!profile) notFound();
  const initials = profile.displayName.split(" ").map((part) => part[0]).slice(0, 2).join("");
  const avatarUrl = profile.avatarKey ? `/media/${profile.avatarKey}` : null;
  const backgroundUrl = profile.backgroundKey ? `/media/${profile.backgroundKey}` : null;

  return (
    <main className="publicProfile" data-has-user-background={Boolean(backgroundUrl)} style={{ "--profile-background-image": backgroundUrl ? `url(${backgroundUrl})` : "none", ...profileAccentStyle(profile.accentColor) } as React.CSSProperties}>
      <Link className="publicBack" href="/" aria-label="Back to home"><span aria-hidden="true">&larr;</span>Back to home</Link>
      <div className="publicBackdrop" aria-hidden="true"><MapuaSquares className="publicSquares publicSquaresPrimary" /><MapuaSquares className="publicSquares publicSquaresSecondary" /></div>
      <section className="publicCard" style={profileAppearanceStyle(appearanceOf(profile))}>
        <Image className="publicCsaLogo" src="/brand/csa-logo.jpg" width={64} height={64} alt="Mapúa University Center for Student Advising" />
        <div className="publicAvatar" aria-hidden="true" style={avatarUrl ? { backgroundImage: `url(${avatarUrl})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}>{avatarUrl ? "" : initials}</div>
        <h1>{profile.displayName}</h1><p className="publicKicker">{profile.roleTitle}</p>
        {profile.showStudentNumber && profile.studentNumber && <p className="profileStudentNumber">Student number {profile.studentNumber}</p>}
        <p className="publicBio">{profile.bio}</p>
        {isCsaEvaluationForm(profile.evaluationUrl) ? <EvaluationPrefill adviserName={profile.displayName} studentNumber={profile.studentNumber} /> : (
          <a className="evaluationButton" href={profile.evaluationUrl} target="_blank" rel="noreferrer">Open session evaluation <span className="srOnly"> (opens in a new tab)</span><SocialIcon className="buttonExternalIcon" platform="external" /></a>
        )}
        {profile.links.length > 0 && <nav className="publicLinks" aria-label={`${profile.displayName} links`}>{profile.links.map(({ service, url }) => <a href={url} target="_blank" rel="noreferrer" key={service} aria-label={`Open ${labels[service] || service} in a new tab`}><span className="socialLinkLabel"><SocialIcon platform={(service in labels ? service : "website") as SocialPlatform} />{labels[service] || service}</span><SocialIcon className="externalLinkIcon" platform="external" /></a>)}</nav>}
        <a className="saveContact publicSave" href={`data:text/vcard;charset=utf-8,${encodeURIComponent(`BEGIN:VCARD\nVERSION:3.0\nFN:${profile.displayName}\nTITLE:${profile.roleTitle}\nEND:VCARD`)}`} download={`${slug}.vcf`}>Save contact</a>
        <p className="providedNotice">This Published Profile contains user-provided information.</p><Link className="reportLink" href={`/report?profile=${encodeURIComponent(slug)}`}>Report this Profile</Link>
      </section>
      <Link className="profileBrand" href="/">Mapúa University CSA</Link>
    </main>
  );
}
