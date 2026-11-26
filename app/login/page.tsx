import Link from "next/link";
import { redirect } from "next/navigation";
import { Brand } from "@/components/brand";
import { getCurrentAccount } from "@/lib/auth/current-user";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await getCurrentAccount()) redirect("/dashboard");
  const { error } = await searchParams;
  return (
    <main className="authPage" id="main">
      <Link className="backLink" href="/">Back to home</Link>
      <section className="authPanel">
        <Brand />
        <div>
          <h1>Sign in to Digital Profile</h1>
          <p>Edit and preview your Draft Profile. Visitors can see only the details you publish. The private Portal is in development for approved Peer Advisers and Administrators.</p>
        </div>
        <Link className="googleButton" href="/login/google"><span aria-hidden="true">G</span>Continue with Google</Link>
        {process.env.NODE_ENV === "development" && <Link className="textLink localDemoLink" href="/login/demo">Use local development account</Link>}
        {process.env.NODE_ENV === "development" && <Link className="textLink" href="/portal">Open the local Portal preview</Link>}
        {error && <p className="authError" role="alert">{error === "not-configured" ? "Google sign-in needs its client credentials before it can start." : "Google sign-in could not be completed. Please try again."}</p>}
        <p className="authTerms">By continuing, you confirm you are at least 18 and agree to the Terms and Privacy Policy.</p>
      </section>
      <aside className="authAside" aria-label="Product information">
        <p>One permanent URL for your NFC Card</p>
        <strong>Publish your Profile when it’s ready.</strong>
        <div className="addressStrip"><span>profile.example/id/</span><b>alex-morgan</b><i>Permanent</i></div>
      </aside>
    </main>
  );
}
