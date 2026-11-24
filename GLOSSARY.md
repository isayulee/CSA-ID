# Digital Profile

The language of the CSA's peer-advising product: public identity pages that people open from an NFC card, and the Peer Advisers' private Portal for Teaching Kits and Advising Requests.

## Language

**User**:
A person who signs in with a Google account and owns exactly one Profile.
_Avoid_: Account, cardholder, member

**Profile**:
A User's customizable public identity page, identified by one permanent Slug.
_Avoid_: ID, badge, card profile, webpage

**Slug**:
The permanent, unique text identifier in a Profile's public URL.
_Avoid_: Username, handle, profile ID

**Draft Profile**:
A Profile visible only to its User and not available at its public URL.
_Avoid_: Private profile, hidden profile

**Published Profile**:
A Profile available to anyone who knows its public URL.
_Avoid_: Public ID, active card

**Suspended Profile**:
A Profile made unavailable by an administrator in response to abuse or risk while its ownership and reserved Slug are retained.
_Avoid_: Banned account, deleted profile

**Social Link**:
A URL on a Profile belonging to one of the supported social or contact services.
_Avoid_: Embed, integration

**Administrator**:
A trusted operator authorized independently of Profile data to review reports and suspend Profiles.
_Avoid_: Admin profile, moderator account

**Abuse Report**:
A request for an Administrator to review a Published Profile for impersonation, malicious links, or prohibited content.
_Avoid_: Complaint, flag

**NFC Card**:
An independently programmed physical tag containing a Profile's public URL; it is not registered or managed by the system.
_Avoid_: Profile, account, managed card

## Peer advising

**Peer Adviser**:
A Mapúa CSA student who tutors fellow students: a User whom an Administrator has approved to use the Portal.
_Avoid_: Student assistant, tutor, mentor

**Portal**:
The signed-in workspace only Peer Advisers can open, holding Teaching Kits, the Directory, the Scheduler and Matching.
_Avoid_: Dashboard, admin panel

**Directory**:
The Portal's list of Peer Advisers, with Officers arranged by position to show the CSA's organizational structure.
_Avoid_: Org chart, roster, members list

**Officer**:
A Peer Adviser who holds a named position in the CSA's organizational structure; the position grants no extra rights.
_Avoid_: Admin, moderator

**Teaching Kit**:
A set of study materials for one course and academic term that Peer Advisers use in tutoring sessions.
_Avoid_: Module, resource pack, course kit

**Kit Draft**:
Proposed changes to a Teaching Kit that wait for an Administrator's approval while the last approved version stays in use.
_Avoid_: Pending kit, kit revision, suggestion

**Course**:
A Mapúa course on the shared list, identified by its course code (for example MATH146), that Teaching Kits, Peer Advisers and Advising Requests refer to.
_Avoid_: Subject, class

**Campus**:
One of Mapúa University's sites, for example Intramuros or Makati, where a Peer Adviser tutors and an Advisee asks to meet.
_Avoid_: Branch, site, location

**Academic Term**:
One numbered term of a Mapúa academic year, for example Term 1 of AY 2026–2027.
_Avoid_: Semester, quarter, trimester

**Availability**:
The hours of the week a Peer Adviser can tutor, kept as 1-hour slots from Monday to Saturday, 8:00 to 17:00.
_Avoid_: Schedule, calendar, free time

**Advisee**:
A Mapúa student who asks the CSA for a tutoring session through the intake Google Form; an Advisee never signs in.
_Avoid_: Tutee, client, student

**Advising Request**:
One advisee's submission of the CSA intake Google Form asking for a tutoring session.
_Avoid_: Booking, consultation, appointment, session request

**Peer Advising Scheduler**:
The Portal view where Peer Advisers see, claim and schedule Advising Requests.
_Avoid_: Queue, calendar, booking system

**Matching**:
The Portal's ranked suggestion of Peer Advisers for an unassigned Advising Request; a person still makes the assignment.
_Avoid_: Auto-assign, pairing algorithm

## Relationships

- A **Peer Adviser** is a **User** and owns one **Profile**
- An **Officer** is a **Peer Adviser**; an **Administrator** is a separate trust grant, not a position
- A **Teaching Kit** belongs to one **Course** and one **Academic Term**
- A **Peer Adviser** tutors on one **Campus** and keeps one **Availability**
- An **Advising Request** comes from one **Advisee** and names one **Campus**
