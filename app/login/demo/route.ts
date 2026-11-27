import { NextResponse } from "next/server";
import { createSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/session";
import { findOrCreateUser } from "@/lib/auth/users";
import { prepareSignIn } from "@/lib/auth/sign-in-landing";
import { getDb } from "@/lib/db";

export async function GET(request: Request) {
  if (process.env.NODE_ENV !== "development") return new Response("Not found", { status: 404 });
  const db = getDb();
  const user = await findOrCreateUser(db, { sub: "local-demo", email: "local-demo@csa.example", name: "Alex Santos" });
  const landing = await prepareSignIn(db, user.id, { displayName: "Alex Santos", roleTitle: "Peer Adviser", bio: "Peer Adviser for tutoring sessions at the Center for Student Advising." });
  const token = await createSession(db, user.id);
  const destination = new URL(request.url).searchParams.get("screen") === "profile" ? "/portal/profile" : landing;
  const response = NextResponse.redirect(new URL(destination, request.url));
  response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions);
  return response;
}
