import Link from "next/link";
import { ProfileCard } from "@/components/profile-card";
import { SiteHeader } from "@/components/site-header";
import { MapuaSquares } from "@/components/mapua-squares";

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main id="main">
        <section className="hero" data-enter>
          <div className="shell heroGrid">
            <div className="heroCopy">
              <h1>Find your Peer Adviser after a tutoring session</h1>
              <p className="heroLead">Tap your Peer Adviser’s NFC Card to open their Published Profile, find their Social Links, and complete the session evaluation.</p>
              <div className="buttonRow">
                <Link className="button" href="/login">Sign in with Google</Link>
                <Link className="buttonSecondary" href="/id/demo">View a sample Profile</Link>
              </div>
              <p className="heroFact">Peer Advisers and Administrators use the same Google sign-in.</p>
            </div>
            <div className="heroVisual" aria-label="Draft Profile and mobile preview">
              <MapuaSquares className="heroSquares" />
              <div className="editorWindow">
                <div className="windowBar"><span /><span /><span /><b>Profile editor</b></div>
                <div className="editorBody">
                  <div className="editorRail"><span className="active" /><span /><span /><span /></div>
                  <div className="editorForm">
                    <p>Draft Profile</p>
                    <label>Name <span>Alex Santos</span></label>
                    <label>Role <span>Peer Adviser</span></label>
                    <label>Profile color <i /></label>
                  </div>
                </div>
              </div>
              <div className="heroCard"><ProfileCard compact /></div>
            </div>
          </div>
        </section>

        <section className="mechanismSection">
          <div className="shell mechanismGrid">
            <div>
              <h2>Prepare for your next session</h2>
              <p>In the private Portal, approved Peer Advisers can find Teaching Kits and coordinate Advising Requests. Administrators use it to review approvals and oversee advising.</p>
            </div>
            <ol className="stepList">
              <li><span>01</span><div><h3>Sign in with Google</h3><p>Open your Draft Profile and, if you’re an approved Peer Adviser, the Portal.</p></div></li>
              <li><span>02</span><div><h3>Add session details</h3><p>Choose your photo, links, background, and evaluation form.</p></div></li>
              <li><span>03</span><div><h3>Publish your Profile</h3><p>Share the permanent URL on your NFC Card. You can publish updates to the same URL.</p></div></li>
            </ol>
          </div>
        </section>
      </main>
      <footer className="homeFooter">
        <div className="shell footerInner"><span>Mapúa University · Center for Student Advising</span><div><Link href="/login">Sign in with Google</Link><Link href="/id/demo">View a sample Profile</Link></div></div>
      </footer>
    </>
  );
}
