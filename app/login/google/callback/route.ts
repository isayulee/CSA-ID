import { NextResponse } from "next/server";
import * as oauth from "oauth4webapi";
import { getDb } from "@/lib/db";
import { googleConfig, googleIssuer } from "@/lib/auth/google";
import { createSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/session";
import { findOrCreateUser } from "@/lib/auth/users";
import { prepareSignIn } from "@/lib/auth/sign-in-landing";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const cookieHeader = request.headers.get("cookie") || "";
  const cookieMap = new Map(cookieHeader.split(";").map((part) => part.trim().split("=").map(decodeURIComponent) as [string, string]));
  const state = cookieMap.get("oauth_state");
  const nonce = cookieMap.get("oauth_nonce");
  const verifier = cookieMap.get("oauth_verifier");
  if (!state || !nonce || !verifier) return NextResponse.redirect(new URL("/login?error=expired", request.url));

  try {
    const { client, clientAuth, redirectUri } = googleConfig(requestUrl.origin);
    const params = oauth.validateAuthResponse(googleIssuer, client, requestUrl, state);
    const tokenResponse = await oauth.authorizationCodeGrantRequest(googleIssuer, client, clientAuth, params, redirectUri, verifier);
    const tokens = await oauth.processAuthorizationCodeResponse(googleIssuer, client, tokenResponse, { expectedNonce: nonce, requireIdToken: true });
    const claims = oauth.getValidatedIdTokenClaims(tokens);
    if (!claims?.sub || typeof claims.email !== "string" || claims.email_verified !== true) throw new Error("Google account email is not verified");

    const db = getDb();
    const user = await findOrCreateUser(db, { sub: claims.sub, email: claims.email, name: typeof claims.name === "string" ? claims.name : undefined });
    const landing = await prepareSignIn(db, user.id, { displayName: user.name });

    const token = await createSession(db, user.id);
    const response = NextResponse.redirect(new URL(landing, request.url));
    response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions);
    response.cookies.delete("oauth_state"); response.cookies.delete("oauth_nonce"); response.cookies.delete("oauth_verifier");
    return response;
  } catch (error) {
    console.error("Google OAuth callback failed", error);
    return NextResponse.redirect(new URL("/login?error=oauth", request.url));
  }
}
