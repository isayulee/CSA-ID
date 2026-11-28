import { z } from "zod";

export const services = ["linkedin", "instagram", "facebook", "github", "youtube", "tiktok", "x", "website"] as const;
export type ProfileService = (typeof services)[number];

const socialLink = z.object({
  service: z.enum(services),
  url: z.string().url().max(500),
});

const color = z.string().regex(/^#[0-9A-Fa-f]{6}$/);

export const profileInput = z.object({
  displayName: z.string().trim().min(1).max(128),
  roleTitle: z.string().trim().min(1).max(128),
  bio: z.string().trim().max(500),
  accentColor: color,
  appearance: z.object({
    iconColor: color,
    cardColor: color,
    cardOpacity: z.number().int().min(70).max(100),
    cardFrosted: z.boolean(),
  }).nullable().optional(),
  evaluationUrl: z.string().url().max(500).startsWith("https://", "Use an HTTPS address for the evaluation form").or(z.literal("")),
  studentNumber: z.string().trim().max(32).regex(/^\d*$/, "Enter a student number using digits only").optional(),
  showStudentNumber: z.boolean().optional(),
  links: z.array(socialLink).max(8).superRefine((links, context) => {
    const unique = new Set(links.map((link) => link.service));
    if (unique.size !== links.length) context.addIssue({ code: "custom", message: "Each platform can be added once" });
  }),
});

export type ProfileInput = z.infer<typeof profileInput>;

export function isSafeProfileUrl(service: ProfileService, rawUrl: string) {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:") return false;
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  const allowed: Partial<Record<ProfileService, string[]>> = {
    linkedin: ["linkedin.com"], instagram: ["instagram.com"], facebook: ["facebook.com", "fb.com"], github: ["github.com"], youtube: ["youtube.com", "youtu.be"], tiktok: ["tiktok.com"], x: ["x.com", "twitter.com"],
  };
  return service === "website" || Boolean(allowed[service]?.some((domain) => host === domain || host.endsWith(`.${domain}`)));
}

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const blockedSlugs = new Set([
  "admin", "administrator", "api", "app", "assets", "auth", "dashboard", "help", "id", "login", "logout", "media", "mod", "moderator", "official", "privacy", "report", "root", "settings", "signin", "signup", "static", "support", "system", "terms", "uploads", "www",
]);

type SlugCheck = { ok: true; slug: string } | { ok: false; reason: "invalid" | "reserved"; message: string };

export function checkSlug(raw: unknown): SlugCheck {
  const slug = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (slug.length < 3 || slug.length > 64 || !SLUG_PATTERN.test(slug)) {
    return { ok: false, reason: "invalid", message: "Use 3 to 64 lowercase letters, numbers, or single hyphens inside the address" };
  }
  if (blockedSlugs.has(slug)) return { ok: false, reason: "reserved", message: "That address is reserved. Please choose another" };
  return { ok: true, slug };
}
