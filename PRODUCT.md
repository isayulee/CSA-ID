# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary users are the Peer Advisers of the Mapúa University Center for Student Advising (CSA). During tutoring sessions, each Peer Adviser shares their public Profile with advisees by tapping an NFC Card. Some Peer Advisers are Officers, who hold a named position in the CSA's organizational structure.

Advisees are the public audience. They view the Peer Adviser's identity and contact links, then follow a link to complete a session evaluation. Advisees ask for tutoring through the CSA intake Google Form and never sign in to this product.

Administrators are up to five trusted CSA members. They approve Peer Advisers, approve Teaching Kit changes, assign Advising Requests, and handle Abuse Reports.

## Product Purpose

The product has two parts that share one sign-in.

The Profile gives each Peer Adviser a virtual business card with one permanent, NFC-friendly public URL. The Peer Adviser can maintain their photo, background, profile details, and supported Social Links without rewriting the NFC Card.

The Portal is the Peer Advisers' private workspace. It holds:

- **Teaching Kits:** study materials for each Course and academic term.
- **Peer Advising Scheduler:** the Advising Requests from the CSA intake Google Form, which Peer Advisers claim and schedule.
- **Matching:** a ranked list of Peer Advisers suggested for each unclaimed Advising Request.
- **Directory:** every Peer Adviser, with Officers arranged by position.

Success means an advisee who asks for help gets a Peer Adviser who tutors that Course, on their campus, at a time they are free. In the session, the Peer Adviser has a reviewed Teaching Kit ready. Afterward, the advisee can tap a card and reach the evaluation form with little friction.

## Positioning

This is the CSA's peer-advising workspace for Mapúa University. Unlike a general social-link page or a shared spreadsheet, it connects the whole tutoring flow: the advisee's request, the Peer Adviser's preparation, the session itself, and the evaluation handoff.

## Operating Context

- Peer Advisers receive physical NFC Cards. Cards are programmed separately with a phone-based NFC tool.
- Advisees tap a card during or immediately after a tutoring session. The card opens the Peer Adviser's public Profile without requiring the advisee to sign in.
- The Profile links to an existing evaluation form. The application does not create, host, or store evaluation responses.
- Advisees ask for tutoring through the CSA intake Google Form. The CSA team cannot change that form. Its responses land in a Google Sheet, where the team may edit only the Peer Adviser, Scheduled Date, and Remarks columns.
- An Apps Script on that Sheet sends each response to the Portal. The script only reads the Sheet; the Portal never writes back to it.
- The team currently tracks each request's status in the Remarks column with six values: Pending, Rescheduled, Done, Cancelled, No Peer Adviser Available, and No Response from Advisee. The Portal uses the same six.
- The team tells an advisee about their Peer Adviser by Microsoft Teams chat. The Portal prepares that message; a person sends it.
- Mapúa has more than one campus. Advisees name their campus in the form, and Peer Advisers tutor on one campus.

## Capabilities and Constraints

### Profile

- One Google-authenticated User owns one Profile.
- Google is the only login method.
- Anyone with a Google account can create a Profile.
- Each Profile has a permanent, non-reusable Slug suitable for an NFC URL.
- A User edits a private Draft Profile, previews it, and explicitly publishes changes.
- Profiles support a photo, background image, short identity information, controlled themes, supported Social Links, and an external evaluation-form link.
- Published Profiles are readable without authentication and clearly identify their content as user-provided.
- NFC Cards are not registered, transferred, or managed inside the application.

### Portal

- Only Peer Advisers and Administrators can open the Portal. A User becomes a Peer Adviser when an Administrator approves them. Losing approval returns the Peer Adviser's open Advising Requests to the unclaimed pool; their Profile keeps working.
- The Officer position is for display only and grants no extra rights. Administrators set it.
- **Teaching Kits** belong to one Course and one academic term. A kit holds text, PDF files of up to 5 MiB each, and links to Google Drive or YouTube for videos and larger files. Only Peer Advisers can see kits for now; a public view may come later.
- Any Peer Adviser can propose a new kit or a change. The proposal is a Kit Draft. It goes live only after an Administrator approves it, and the last approved version stays in use meanwhile.
- One shared Course list (course code and title) is used by Teaching Kits, Peer Advisers, and Advising Requests. Any Peer Adviser can add a Course.
- **Peer Advising Scheduler:** Peer Advisers claim unclaimed Advising Requests for themselves and can give them back. Only Administrators assign a request to someone else. Post-session notes are visible to the claiming Peer Adviser and Administrators only.
- At launch, every existing Sheet row is imported, including past sessions. The Student's Signature answer is never copied.
- Advisee personal data is kept for now. The data model keeps it separate so it can be deleted on a schedule later.
- **Matching** only suggests. It lists Peer Advisers who tutor the Course and work on the advisee's campus, and ranks them by how many hours of the advisee's stated free time overlap with their weekly availability. Fewer open requests breaks ties. When the advisee's free-text times cannot be read, the request is marked "times unclear" and a Peer Adviser sets the times by hand.
- Each Peer Adviser keeps a weekly availability grid of 1-hour slots, Monday to Saturday, 8:00 to 17:00.

### Infrastructure

- Hosting, database, authentication, and storage must remain within strict free-tier limits. Quota failure or temporary downtime is preferable to paid overages.
- No custom domain is currently available. NFC Cards remain writable until a stable domain is controlled.
- The product is non-commercial.

## Brand Commitments

“Digital Profile” is a temporary working name, and the Portal is the "Peer Adviser's Portal". The product may use the Mapúa University and Center for Student Advising names, logos, and official branding with authorization. The supplied CSA seal and Mapúa red, gold, and modular-square visual references live in [`public/brand`](./public/brand/). The permanent product name has not yet been supplied.

## Evidence on Hand

- [`agent_technical_readme.md`](./agent_technical_readme.md) contains the current architecture, security model, data model, and implementation requirements.
- [`GLOSSARY.md`](./GLOSSARY.md) defines the canonical domain language.
- The CSA intake form's fields and the Sheet's six status values come from the CSA team.
- No testimonials, usage metrics, evaluation results, or other promotional proof have been supplied. Future work must not fabricate them.

## Product Principles

1. Make the tutoring-session handoff immediate: tap, identify the Peer Adviser, open the evaluation.
2. Keep the public URL stable while allowing the Peer Adviser to update the Profile behind it.
3. Show only information the Peer Adviser deliberately publishes.
4. Prefer bounded failure over unexpected infrastructure cost.
5. Keep evaluation responses in the existing evaluation system rather than duplicating sensitive data.
6. Show advisee personal data only to the people who need it: the claiming Peer Adviser and Administrators get full details; other Peer Advisers see only what they need to decide whether to claim.
7. Suggest, never decide: Matching and the time parser help a person choose and never assign or schedule on their own.

## Accessibility & Inclusion

The public Profile is mobile-first because advisees reach it from an NFC tap. Peer Advisers often use the Portal on phones between classes. Public, dashboard, and Portal surfaces must support keyboard navigation, visible focus, sufficient contrast, reduced motion, screen-reader labels, and responsive layouts on common mobile browsers.

## Open Decisions

- Permanent product name.
- Final evaluation-form URL and whether it is shared or specific to each Peer Adviser.
- Stable custom domain for permanent NFC URLs.
- What other Peer Advisers see of an unclaimed Advising Request before claiming it (course, campus, and times only, or also the advisee's name).
- Whether later Sheet edits to an already imported row (the team still edits the three columns by hand) should update the Portal, or whether the Portal ignores them.
- When advisee personal data is deleted.
- When Teaching Kits become public, and which ones.
