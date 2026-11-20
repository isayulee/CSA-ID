import { profileAppearanceStyle, type ProfileAppearance } from "@/lib/profile-appearance";
import { SocialIcon, type SocialPlatform } from "./social-icon";

type ProfileCardProps = {
  compact?: boolean;
  name?: string;
  role?: string;
  bio?: string;
  studentNumber?: string;
  primary?: string;
  avatarUrl?: string;
  coverUrl?: string;
  appearance?: ProfileAppearance | null;
  socialLinks?: Array<{ service: SocialPlatform; label: string }>;
};

export function ProfileCard({
  compact = false,
  name = "Alex Santos",
  role = "Student assistant",
  bio = "Peer adviser for tutoring sessions at the Center for Student Advising.",
  studentNumber,
  primary = "#b5121b",
  avatarUrl,
  coverUrl,
  appearance,
  socialLinks,
}: ProfileCardProps) {
  return (
    <article className={`profileCard ${compact ? "profileCardCompact" : ""}`} style={{ ...profileAppearanceStyle(appearance), "--profile-accent": primary, "--preview-background": coverUrl ? `url(${coverUrl})` : undefined } as React.CSSProperties}>
      <div className="profileCover" aria-hidden="true" style={coverUrl ? { backgroundImage: `url(${coverUrl})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}>{!coverUrl && <><span /><span /><span /></>}</div>
      <div className="profileBody">
        <div className="avatar" aria-label={`${name} profile image`} style={avatarUrl ? { backgroundImage: `url(${avatarUrl})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}>{avatarUrl ? "" : name.split(" ").map((part) => part[0]).join("")}</div>
        <div className="profileIdentity">
          <p className="profileName">{name}</p>
          <p className="profileRole">{role}</p>
        </div>
        {studentNumber && <p className="profileStudentNumber">Student number {studentNumber}</p>}
        <p className="profileBio">{bio}</p>
        {socialLinks ? (
          socialLinks.length > 0 && <div className="profileLinks" aria-label="Profile links">
            {socialLinks.map(({ service, label }) => <span key={service}><SocialIcon platform={service} />{label}</span>)}
          </div>
        ) : <div className="profileLinks" aria-label="Profile links"><span>LinkedIn</span><span>Facebook</span><span>Instagram</span></div>}
        <button className="saveContact" type="button">Open evaluation form</button>
      </div>
    </article>
  );
}
