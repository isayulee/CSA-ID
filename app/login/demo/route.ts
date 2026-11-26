import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { createSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/session";
import { findOrCreateUser } from "@/lib/auth/users";
import { getDb } from "@/lib/db";
import { profiles } from "@/lib/db/schema";

export async function GET(request: Request) {
  if (process.env.NODE_ENV !== "development") return new Response("Not found", { status: 404 });
  const db = getDb();
  const user = await findOrCreateUser(db, { sub: "local-demo", email: "local-demo@csa.example", name: "Alex Santos" });
  const [profile] = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.userId, user.id)).limit(1);
  if (!profile) await db.insert(profiles).values({ id: crypto.randomUUID(), userId: user.id, displayName: "Alex Santos", roleTitle: "Peer Adviser", bio: "Peer Adviser for tutoring sessions at the Center for Student Advising." });
  const token = await createSession(db, user.id);
  const response = NextResponse.redirect(new URL("/dashboard", request.url));
  response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions);
  return response;
}
