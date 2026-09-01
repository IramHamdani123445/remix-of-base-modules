# Internal Audit — UAT Case Pack

Environment: TEST. Dataset: UAT-IA-2030-01. Personas: nine Internal Audit UAT accounts.

Total cases: **108**. Every case carries the full field set in `INTERNAL-AUDIT-UAT-CASES.csv`;
the tables below are the business-readable view used during execution.


## Login / Navigation / Personas

### IA-UAT-LGN-001 — Head of Internal Audit signs in

- **Business objective:** Confirm the Head of Internal Audit can reach the audit workspace after sign-in
- **Persona:** Head of Internal Audit (audit.hia)
- **Preconditions:** Persona account active
- **Test data:** audit.hia
- **Navigation:** Sign-in page
- **Steps:** 1. Open the application. 2. Enter the Head of Internal Audit user name and password. 3. Sign in.
- **Expected result:** Sign-in succeeds and the Internal Audit landing page is displayed with the user's name and role
- **Expected status:** Authenticated
- **Expected notification:** No
- **Expected next user:** Same user
- **Security / SoD expectation:** Only Internal Audit content is offered
- **Evidence required:** Screenshot of landing page
- **Result:** NOT RUN (recorded in the execution report)

### IA-UAT-LGN-002 — Sidebar reflects Head of Internal Audit duties

- **Business objective:** Confirm menu content matches the role's responsibilities
- **Persona:** Head of Internal Audit (audit.hia)
- **Preconditions:** Signed in as HIA
- **Test data:** -
- **Navigation:** Left navigation
- **Steps:** 1. Review the Internal Audit sections in the left menu. 2. Expand each group.
- **Expected result:** Planning, approval, audits, action centre, registers, reports and reference data are visible
- **Expected status:** Authenticated
- **Expected notification:** No
- **Expected next user:** Same user
- **Security / SoD expectation:** Configuration-only screens are not offered unless the role is entitled
- **Evidence required:** Sidebar screenshot
- **Result:** NOT RUN (recorded in the execution report)

### IA-UAT-LGN-003 — Lead Auditor sign-in and menu

- **Business objective:** Confirm the Lead Auditor sees engagement delivery functions
- **Persona:** Lead Auditor (audit.lead)
- **Preconditions:** Persona account active
- **Test data:** audit.lead
- **Navigation:** Sign-in page then left navigation
- **Steps:** 1. Sign in as the Lead Auditor. 2. Review the left menu.
- **Expected result:** Audits, programme, fieldwork, findings, reports and action centre are available; plan approval is not offered
- **Expected status:** Authenticated
- **Expected notification:** No
- **Expected next user:** Same user
- **Security / SoD expectation:** Plan approval must not be offered to the preparer
- **Evidence required:** Sidebar screenshot
- **Result:** NOT RUN (recorded in the execution report)

### IA-UAT-LGN-004 — Audit Team Member sign-in and menu

- **Business objective:** Confirm the team member sees assigned work only
- **Persona:** Audit Team Member 1 (audit.auditor1)
- **Preconditions:** Persona account active
- **Test data:** audit.auditor1
- **Navigation:** Sign-in page then left navigation
- **Steps:** 1. Sign in as Audit Team Member 1. 2. Review the left menu and the Action Centre entry.
- **Expected result:** Assigned audits, fieldwork, evidence and findings are available; planning and approval functions are not
- **Expected status:** Authenticated
- **Expected notification:** No
- **Expected next user:** Same user
- **Security / SoD expectation:** No planning, approval or configuration entries
- **Evidence required:** Sidebar screenshot
- **Result:** NOT RUN (recorded in the execution report)

### IA-UAT-LGN-005 — Auditee management sign-in and workspace

- **Business objective:** Confirm an auditee reaches a management workspace, not the audit workspace
- **Persona:** Benefits Management / Auditee (audit.mgmt.benefits)
- **Preconditions:** Persona account active
- **Test data:** audit.mgmt.benefits
- **Navigation:** Sign-in page
- **Steps:** 1. Sign in as Benefits Management. 2. Observe the landing page and menu.
- **Expected result:** A management workspace listing the department's audit obligations is shown
- **Expected status:** Authenticated
- **Expected notification:** No
- **Expected next user:** Same user
- **Security / SoD expectation:** No auditor working papers, planning or quality review entries
- **Evidence required:** Screenshot of management landing page
- **Result:** NOT RUN (recorded in the execution report)

### IA-UAT-LGN-006 — Sign out and session end

- **Business objective:** Confirm a business user can end the session safely
- **Persona:** Head of Internal Audit (audit.hia)
- **Preconditions:** Signed in
- **Test data:** -
- **Navigation:** User menu
- **Steps:** 1. Open the user menu. 2. Select sign out. 3. Attempt to return to the previous page using the browser back button.
- **Expected result:** The session ends and the previous audit page is no longer readable
- **Expected status:** Signed out
- **Expected notification:** No
- **Expected next user:** -
- **Security / SoD expectation:** Session content is not readable after sign-out
- **Evidence required:** Screenshot after sign-out
- **Result:** NOT RUN (recorded in the execution report)


## Audit Administration

### IA-UAT-ADM-001 — Maintain audited departments

- **Business objective:** Confirm reference departments can be maintained
- **Persona:** Audit System Administrator (audit.admin)
- **Preconditions:** Signed in as Audit Administrator
- **Test data:** UAT department record
- **Navigation:** Internal Audit > Departments
- **Steps:** 1. Open Departments. 2. Review the list. 3. Open one department and review its details.
- **Expected result:** Departments load with name, head and active state
- **Expected status:** Read-only pass
- **Expected notification:** No
- **Expected next user:** -
- **Security / SoD expectation:** Administrator may maintain reference data only
- **Evidence required:** Screenshot of Departments list
- **Result:** NOT RUN (recorded in the execution report)

### IA-UAT-ADM-002 — Maintain business functions

- **Business objective:** Confirm functions can be maintained and are distinct from processes
- **Persona:** Audit System Administrator (audit.admin)
- **Preconditions:** Departments exist
- **Test data:** UAT function
- **Navigation:** Internal Audit > Business Functions
- **Steps:** 1. Open Business Functions. 2. Confirm each function is linked to a department. 3. Confirm functions are not presented as processes.
- **Expected result:** Functions list correctly and remain distinct from processes
- **Expected status:** Read-only pass
- **Expected notification:** No
- **Expected next user:** -
- **Security / SoD expectation:** Reference data only
- **Evidence required:** Screenshot
- **Result:** NOT RUN (recorded in the execution report)

### IA-UAT-ADM-003 — Auditor register

- **Business objective:** Confirm the auditor register is complete and usable for planning
- **Persona:** Audit System Administrator (audit.admin)
- **Preconditions:** Auditors exist
- **Test data:** Auditor profiles
- **Navigation:** Internal Audit > Auditor Profiles
- **Steps:** 1. Open Auditor Profiles. 2. Review grade, availability and specialisation.
- **Expected result:** All active auditors are listed with the attributes needed for assignment
- **Expected status:** Read-only pass
- **Expected notification:** No
- **Expected next user:** -
- **Security / SoD expectation:** Administrator cannot assign engagements
- **Evidence required:** Screenshot
- **Result:** NOT RUN (recorded in the execution report)

### IA-UAT-ADM-004 — Administrator is not the Head of Internal Audit

- **Business objective:** Prevent administrative rights being read as audit authority
- **Persona:** Audit System Administrator (audit.admin)
- **Preconditions:** Signed in as Audit Administrator
- **Test data:** -
- **Navigation:** Direct navigation to plan approval
- **Steps:** 1. Enter the plan approval address directly. 2. Observe the outcome.
- **Expected result:** Access is refused or the approval controls are unavailable
- **Expected status:** Denied
- **Expected notification:** No
- **Expected next user:** -
- **Security / SoD expectation:** Administration must never confer approval authority
- **Evidence required:** Screenshot of refusal
- **Result:** NOT RUN (recorded in the execution report)


## Audit Universe

### IA-UAT-UNV-001 — Audit universe hierarchy

- **Business objective:** Confirm the universe supports organisation, department, function and process levels
- **Persona:** Audit System Administrator (audit.admin)
- **Preconditions:** Universe seeded
- **Test data:** UAT universe entity
- **Navigation:** Internal Audit > Audit Universe
- **Steps:** 1. Open the Audit Universe. 2. Inspect the hierarchy levels. 3. Open one auditable entity.
- **Expected result:** Hierarchy is coherent and functions are not confused with processes
- **Expected status:** Read-only pass
- **Expected notification:** No
- **Expected next user:** -
- **Security / SoD expectation:** -
- **Evidence required:** Screenshot of the universe
- **Result:** NOT RUN (recorded in the execution report)

### IA-UAT-UNV-002 — Universe entity used in planning

- **Business objective:** Confirm auditable entities can be selected when planning
- **Persona:** Lead Auditor (audit.lead)
- **Preconditions:** Universe entities active
- **Test data:** UAT entity
- **Navigation:** Internal Audit > Audit Plans > add engagement
- **Steps:** 1. Start adding an engagement to a plan. 2. Select an auditable entity.
- **Expected result:** The entity list is available and selection is retained
- **Expected status:** Draft
- **Expected notification:** No
- **Expected next user:** Same user
- **Security / SoD expectation:** -
- **Evidence required:** Screenshot
- **Result:** NOT RUN (recorded in the execution report)

### IA-UAT-UNV-003 — Inactive entity handling

- **Business objective:** Confirm inactive entities cannot be selected for new work
- **Persona:** Audit System Administrator (audit.admin)
- **Preconditions:** One inactive entity
- **Test data:** Inactive entity
- **Navigation:** Internal Audit > Audit Universe
- **Steps:** 1. Mark or identify an inactive entity. 2. Attempt to use it when planning.
- **Expected result:** Inactive entities do not appear as planning candidates
- **Expected status:** Denied
- **Expected notification:** No
- **Expected next user:** -
- **Security / SoD expectation:** -
- **Evidence required:** Screenshot
- **Result:** NOT RUN (recorded in the execution report)


## Risk Assessment

### IA-UAT-RSK-001 — Risk register entries

- **Business objective:** Confirm risks can be recorded against departments and functions
- **Persona:** Lead Auditor (audit.lead)
- **Preconditions:** Departments exist
- **Test data:** UAT risk
- **Navigation:** Internal Audit > Risk Register
- **Steps:** 1. Open the Risk Register. 2. Create a risk with description, category, owner and department.
- **Expected result:** Risk is saved and appears in the register
- **Expected status:** Saved
- **Expected notification:** No
- **Expected next user:** Same user
- **Security / SoD expectation:** -
- **Evidence required:** Screenshot with the risk reference
- **Result:** NOT RUN (recorded in the execution report)

### IA-UAT-RSK-002 — Risk scoring and band

- **Business objective:** Confirm the configured methodology produces a score and band
- **Persona:** Lead Auditor (audit.lead)
- **Preconditions:** Scoring configuration active
- **Test data:** UAT risk
- **Navigation:** Internal Audit > Risk Assessment
- **Steps:** 1. Open Risk Assessment. 2. Score impact and likelihood using the configured scale. 3. Save.
- **Expected result:** Score and risk band are produced by the configured methodology, not typed by hand
- **Expected status:** Saved
- **Expected notification:** No
- **Expected next user:** Same user
- **Security / SoD expectation:** -
- **Evidence required:** Screenshot showing score and band
- **Result:** NOT RUN (recorded in the execution report)

### IA-UAT-RSK-003 — Residual risk and control consideration

- **Business objective:** Confirm control strength is considered where implemented
- **Persona:** Lead Auditor (audit.lead)
- **Preconditions:** Risk scored
- **Test data:** UAT risk
- **Navigation:** Internal Audit > Risk Assessment
- **Steps:** 1. Record control effectiveness. 2. Review the residual or composite result.
- **Expected result:** Residual result reflects the configured methodology
- **Expected status:** Saved
- **Expected notification:** No
- **Expected next user:** Same user
- **Security / SoD expectation:** -
- **Evidence required:** Screenshot
- **Result:** NOT RUN (recorded in the execution report)

### IA-UAT-RSK-004 — Risk-based audit priority

- **Business objective:** Confirm risk rating drives audit priority and candidate generation
- **Persona:** Head of Internal Audit (audit.hia)
- **Preconditions:** Risk assessments complete
- **Test data:** UAT risks
- **Navigation:** Internal Audit > Audit Plans > generate candidates
- **Steps:** 1. Generate plan candidates. 2. Compare the ordering with the risk bands.
- **Expected result:** High risk entities are prioritised for audit
- **Expected status:** Draft
- **Expected notification:** No
- **Expected next user:** Same user
- **Security / SoD expectation:** -
- **Evidence required:** Screenshot of candidates
- **Result:** NOT RUN (recorded in the execution report)


## Annual Audit Plan

### IA-UAT-PLN-001 — Create the UAT annual plan

- **Business objective:** Confirm an annual plan can be created for a fiscal year
- **Persona:** Head of Internal Audit (audit.hia)
- **Preconditions:** No plan exists for the UAT year
- **Test data:** UAT-IA-2030-01
- **Navigation:** Internal Audit > Audit Plans > New
- **Steps:** 1. Create a plan for the UAT fiscal year. 2. Enter title, objective, scope and methodology. 3. Save as draft.
- **Expected result:** Plan is created in Draft with the UAT reference
- **Expected status:** Draft
- **Expected notification:** No
- **Expected next user:** Lead Auditor
- **Security / SoD expectation:** Only planning roles may create plans
- **Evidence required:** Screenshot of the draft plan
- **Result:** NOT RUN (recorded in the execution report)

### IA-UAT-PLN-002 — Add engagements to the plan

- **Business objective:** Confirm the plan can carry the UAT portfolio
- **Persona:** Lead Auditor (audit.lead)
- **Preconditions:** Draft plan exists
- **Test data:** 8-10 UAT engagements across Benefits, Compliance and Finance
- **Navigation:** Audit Plans > open plan > Engagements
- **Steps:** 1. Add engagements for the three departments with objectives and audit types. 2. Save.
- **Expected result:** All UAT engagements are listed against the plan
- **Expected status:** Draft
- **Expected notification:** No
- **Expected next user:** Same user
- **Security / SoD expectation:** -
- **Evidence required:** Screenshot of the engagement list
- **Result:** NOT RUN (recorded in the execution report)

### IA-UAT-PLN-003 — Planned quarter and effort

- **Business objective:** Confirm scheduling and effort can be planned
- **Persona:** Lead Auditor (audit.lead)
- **Preconditions:** Engagements added
- **Test data:** Quarter, planned days
- **Navigation:** Audit Plans > engagement row
- **Steps:** 1. Set planned quarter and planned days/hours for each engagement. 2. Save.
- **Expected result:** Planned quarter and effort are stored and totalled
- **Expected status:** Draft
- **Expected notification:** No
- **Expected next user:** Same user
- **Security / SoD expectation:** -
- **Evidence required:** Screenshot of totals
- **Result:** NOT RUN (recorded in the execution report)

### IA-UAT-PLN-004 — Lead and reviewer assignment

- **Business objective:** Confirm resourcing is captured
- **Persona:** Lead Auditor (audit.lead)
- **Preconditions:** Auditors registered
- **Test data:** Lead and reviewer
- **Navigation:** Audit Plans > engagement row
- **Steps:** 1. Assign a Lead Auditor and a reviewer per engagement. 2. Save.
- **Expected result:** Assignments are stored and visible in the plan
- **Expected status:** Draft
- **Expected notification:** No
- **Expected next user:** Assigned auditors
- **Security / SoD expectation:** Reviewer must differ from the Lead
- **Evidence required:** Screenshot
- **Result:** NOT RUN (recorded in the execution report)

### IA-UAT-PLN-005 — Capacity check

- **Business objective:** Confirm the plan warns when capacity is exceeded
- **Persona:** Head of Internal Audit (audit.hia)
- **Preconditions:** Effort planned
- **Test data:** Planned vs available hours
- **Navigation:** Internal Audit > Workload & Capacity
- **Steps:** 1. Review planned hours against available capacity.
- **Expected result:** Over-allocation is visible to the planner
- **Expected status:** Draft
- **Expected notification:** No
- **Expected next user:** Same user
- **Security / SoD expectation:** -
- **Evidence required:** Screenshot of capacity view
- **Result:** NOT RUN (recorded in the execution report)

### IA-UAT-PLN-006 — Submit the plan for approval

- **Business objective:** Confirm the plan enters the approval queue
- **Persona:** Lead Auditor (audit.lead)
- **Preconditions:** Plan complete in Draft
- **Test data:** UAT-IA-2030-01
- **Navigation:** Audit Plans > Submit
- **Steps:** 1. Submit the plan for approval. 2. Confirm.
- **Expected result:** Plan status becomes Submitted and appears in the approval queue
- **Expected status:** Submitted
- **Expected notification:** Yes - Head of Internal Audit
- **Expected next user:** Head of Internal Audit
- **Security / SoD expectation:** Preparer cannot approve
- **Evidence required:** Screenshot and notification evidence
- **Result:** NOT RUN (recorded in the execution report)

### IA-UAT-PLN-007 — Reject the plan with reason

- **Business objective:** Confirm rejection returns the plan for revision
- **Persona:** Head of Internal Audit (audit.hia)
- **Preconditions:** Plan submitted
- **Test data:** Rejection reason
- **Navigation:** Internal Audit > Plan Approval
- **Steps:** 1. Open the submitted plan. 2. Reject with a reason.
- **Expected result:** Plan returns to the preparer with the reason recorded
- **Expected status:** Rejected
- **Expected notification:** Yes - Lead Auditor
- **Expected next user:** Lead Auditor
- **Security / SoD expectation:** Reason must be mandatory
- **Evidence required:** Screenshot
- **Result:** NOT RUN (recorded in the execution report)

### IA-UAT-PLN-008 — Revise and resubmit

- **Business objective:** Confirm the revision loop works and versions increment
- **Persona:** Lead Auditor (audit.lead)
- **Preconditions:** Plan rejected
- **Test data:** Revised plan
- **Navigation:** Audit Plans > open plan
- **Steps:** 1. Amend the plan. 2. Resubmit.
- **Expected result:** Plan returns to Submitted and the version number increases
- **Expected status:** Submitted
- **Expected notification:** Yes - Head of Internal Audit
- **Expected next user:** Head of Internal Audit
- **Security / SoD expectation:** -
- **Evidence required:** Screenshot of version history
- **Result:** NOT RUN (recorded in the execution report)

### IA-UAT-PLN-009 — Approve the annual plan

- **Business objective:** Confirm approval by the Head of Internal Audit
- **Persona:** Head of Internal Audit (audit.hia)
- **Preconditions:** Plan submitted
- **Test data:** UAT-IA-2030-01
- **Navigation:** Internal Audit > Plan Approval
- **Steps:** 1. Open the plan. 2. Approve with comments.
- **Expected result:** Plan becomes Approved with approver and date recorded and the version history is retained
- **Expected status:** Approved
- **Expected notification:** Yes - Lead Auditor and audit team
- **Expected next user:** Lead Auditor
- **Security / SoD expectation:** Only the Head of Internal Audit may approve
- **Evidence required:** Screenshot of approved plan
- **Result:** NOT RUN (recorded in the execution report)


## Audit Scheduling & Intimation

### IA-UAT-SCH-001 — Schedule a planned engagement

- **Business objective:** Confirm an approved engagement can be scheduled
- **Persona:** Lead Auditor (audit.lead)
- **Preconditions:** Plan approved
- **Test data:** ENG-UAT-2030-001
- **Navigation:** Internal Audit > Audits > engagement
- **Steps:** 1. Open the engagement. 2. Enter planned start and end dates, scope and auditee contact. 3. Schedule.
- **Expected result:** Engagement status becomes Scheduled with a schedule version
- **Expected status:** Scheduled
- **Expected notification:** Yes - auditee department
- **Expected next user:** Auditee management
- **Security / SoD expectation:** Only the Lead may schedule
- **Evidence required:** Screenshot with dates
- **Result:** NOT RUN (recorded in the execution report)

### IA-UAT-SCH-002 — Formal intimation to the auditee

- **Business objective:** Confirm the auditee is formally informed
- **Persona:** Lead Auditor (audit.lead)
- **Preconditions:** Engagement scheduled
- **Test data:** Benefits, Compliance and Finance engagements
- **Navigation:** Audits > engagement > Communications
- **Steps:** 1. Confirm intimation is issued. 2. Sign in as the auditee and open the notification.
- **Expected result:** Auditee receives an intimation carrying the correct dates and scope and can open the engagement workspace
- **Expected status:** Scheduled
- **Expected notification:** Yes - Email and in-app
- **Expected next user:** Auditee management
- **Security / SoD expectation:** Only the audited department is informed
- **Evidence required:** Notification screenshot for each department
- **Result:** NOT RUN (recorded in the execution report)

### IA-UAT-SCH-003 — Reschedule and cancel controls

- **Business objective:** Confirm date changes are controlled
- **Persona:** Lead Auditor (audit.lead)
- **Preconditions:** Engagement scheduled
- **Test data:** Reschedule reason
- **Navigation:** Audits > engagement > Reschedule
- **Steps:** 1. Attempt to reschedule without a reason. 2. Reschedule with a reason. 3. Cancel a different engagement with a reason.
- **Expected result:** Reschedule without a reason is refused; with a reason the change and its history are recorded and the auditee is re-notified
- **Expected status:** Rescheduled
- **Expected notification:** Yes - auditee
- **Expected next user:** Auditee management
- **Security / SoD expectation:** Reason is mandatory
- **Evidence required:** Screenshots of both attempts
- **Result:** NOT RUN (recorded in the execution report)


## Audit Preparation

### IA-UAT-PRP-001 — Preparation checklist and entrance meeting

- **Business objective:** Confirm preparation can be completed
- **Persona:** Lead Auditor (audit.lead)
- **Preconditions:** Engagement scheduled
- **Test data:** Scope, objectives, period, team
- **Navigation:** Audits > engagement > Preparation
- **Steps:** 1. Complete scope, objectives, audit period and team. 2. Record the entrance meeting. 3. Mark preparation complete.
- **Expected result:** Preparation is recorded and the engagement can advance
- **Expected status:** In Preparation to Fieldwork
- **Expected notification:** Yes - audit team and auditee
- **Expected next user:** Audit team
- **Security / SoD expectation:** -
- **Evidence required:** Screenshot of preparation tab
- **Result:** NOT RUN (recorded in the execution report)

### IA-UAT-PRP-002 — Incomplete preparation blocks progress

- **Business objective:** Confirm the lifecycle gate works
- **Persona:** Lead Auditor (audit.lead)
- **Preconditions:** Preparation incomplete
- **Test data:** -
- **Navigation:** Audits > engagement
- **Steps:** 1. Attempt to advance to fieldwork with preparation incomplete.
- **Expected result:** Progression is refused and the outstanding items are listed
- **Expected status:** Denied
- **Expected notification:** No
- **Expected next user:** Same user
- **Security / SoD expectation:** -
- **Evidence required:** Screenshot of the block message
- **Result:** NOT RUN (recorded in the execution report)


## Information Requests

### IA-UAT-INF-001 — Raise an information request

- **Business objective:** Confirm the auditor can request information with a due date
- **Persona:** Audit Team Member 1 (audit.auditor1)
- **Preconditions:** Engagement in preparation or fieldwork
- **Test data:** UAT information request
- **Navigation:** Audits > engagement > Information Requests
- **Steps:** 1. Create a request describing the information required. 2. Set a due date. 3. Issue it.
- **Expected result:** Request is issued and visible to the auditee
- **Expected status:** Issued
- **Expected notification:** Yes - auditee
- **Expected next user:** Auditee management
- **Security / SoD expectation:** Only the audited department receives it
- **Evidence required:** Screenshot with request reference
- **Result:** NOT RUN (recorded in the execution report)

### IA-UAT-INF-002 — Auditee supplies information

- **Business objective:** Confirm the auditee can respond with attachments
- **Persona:** Benefits Management / Auditee (audit.mgmt.benefits)
- **Preconditions:** Request issued
- **Test data:** Attachment
- **Navigation:** Management workspace > Information Requests
- **Steps:** 1. Open the request. 2. Upload the information and submit.
- **Expected result:** Submission is recorded and the auditor is informed
- **Expected status:** Submitted
- **Expected notification:** Yes - requesting auditor
- **Expected next user:** Requesting auditor
- **Security / SoD expectation:** Auditee sees only its own requests
- **Evidence required:** Screenshot
- **Result:** NOT RUN (recorded in the execution report)

### IA-UAT-INF-003 — Auditor requests clarification

- **Business objective:** Confirm the clarification loop
- **Persona:** Audit Team Member 1 (audit.auditor1)
- **Preconditions:** Information submitted
- **Test data:** Clarification note
- **Navigation:** Audits > engagement > Information Requests
- **Steps:** 1. Review the submission. 2. Request clarification with a note.
- **Expected result:** Request returns to the auditee with the clarification note
- **Expected status:** Clarification Requested
- **Expected notification:** Yes - auditee
- **Expected next user:** Auditee management
- **Security / SoD expectation:** -
- **Evidence required:** Screenshot
- **Result:** NOT RUN (recorded in the execution report)

### IA-UAT-INF-004 — Request fulfilled and reminders stop

- **Business objective:** Confirm terminal state stops chasing
- **Persona:** Audit Team Member 1 (audit.auditor1)
- **Preconditions:** Clarification supplied
- **Test data:** -
- **Navigation:** Audits > engagement > Information Requests
- **Steps:** 1. Accept the clarification and mark the request fulfilled. 2. Review reminders afterwards.
- **Expected result:** Request is Fulfilled and no further due or overdue reminders are produced
- **Expected status:** Fulfilled
- **Expected notification:** No further reminders
- **Expected next user:** -
- **Security / SoD expectation:** -
- **Evidence required:** Screenshot and reminder history
- **Result:** NOT RUN (recorded in the execution report)


## Auditor / Auditee Query Cycle

### IA-UAT-QRY-001 — Auditor query and management reply

- **Business objective:** Confirm the query cycle is a two-way business conversation
- **Persona:** Audit Team Member 1 (audit.auditor1)
- **Preconditions:** Fieldwork in progress
- **Test data:** UAT query
- **Navigation:** Audits > engagement > Queries
- **Steps:** 1. Raise a query to the auditee. 2. Sign in as management and reply. 3. Return as auditor and read the reply.
- **Expected result:** The reply is presented as a management response, not as a reminder
- **Expected status:** Answered
- **Expected notification:** Yes - both directions
- **Expected next user:** Auditor then management
- **Security / SoD expectation:** Only the audited department participates
- **Evidence required:** Screenshot of the thread
- **Result:** NOT RUN (recorded in the execution report)

### IA-UAT-QRY-002 — Query resolution and history

- **Business objective:** Confirm the conversation history is retained
- **Persona:** Audit Team Member 1 (audit.auditor1)
- **Preconditions:** Query answered
- **Test data:** -
- **Navigation:** Audits > engagement > Queries
- **Steps:** 1. Request further clarification. 2. Receive the second reply. 3. Resolve the query.
- **Expected result:** Full chronological history with author and date is retained
- **Expected status:** Resolved
- **Expected notification:** No
- **Expected next user:** -
- **Security / SoD expectation:** -
- **Evidence required:** Screenshot of history
- **Result:** NOT RUN (recorded in the execution report)


## RCM / Audit Programme

### IA-UAT-RCM-001 — Build the risk and control matrix

- **Business objective:** Confirm process, risk and control can be captured
- **Persona:** Audit Team Member 1 (audit.auditor1)
- **Preconditions:** Engagement in preparation
- **Test data:** UAT process/risk/control
- **Navigation:** Audits > engagement > Programme / RCM
- **Steps:** 1. Add a process. 2. Add a risk to the process. 3. Add a control to the risk.
- **Expected result:** The matrix is built and linked correctly
- **Expected status:** Draft
- **Expected notification:** No
- **Expected next user:** Same user
- **Security / SoD expectation:** -
- **Evidence required:** Screenshot of the matrix
- **Result:** NOT RUN (recorded in the execution report)

### IA-UAT-RCM-002 — Audit objectives and procedures

- **Business objective:** Confirm the audit programme is derived from the matrix
- **Persona:** Audit Team Member 1 (audit.auditor1)
- **Preconditions:** Matrix built
- **Test data:** UAT procedure
- **Navigation:** Audits > engagement > Programme
- **Steps:** 1. Add an audit objective. 2. Add procedures with expected evidence. 3. Assign an auditor and reviewer.
- **Expected result:** Procedures carry owner, reviewer and expected evidence
- **Expected status:** Draft
- **Expected notification:** Yes - assigned auditor
- **Expected next user:** Assigned auditor
- **Security / SoD expectation:** Performer and reviewer must differ
- **Evidence required:** Screenshot
- **Result:** NOT RUN (recorded in the execution report)

### IA-UAT-RCM-003 — Transition to fieldwork

- **Business objective:** Confirm the programme gate
- **Persona:** Lead Auditor (audit.lead)
- **Preconditions:** Programme complete
- **Test data:** -
- **Navigation:** Audits > engagement
- **Steps:** 1. Advance the engagement to fieldwork.
- **Expected result:** Fieldwork is opened only when the programme is complete
- **Expected status:** Fieldwork
- **Expected notification:** Yes - audit team
- **Expected next user:** Audit team
- **Security / SoD expectation:** -
- **Evidence required:** Screenshot
- **Result:** NOT RUN (recorded in the execution report)


## Fieldwork & Control Testing

### IA-UAT-FLD-001 — Assigned work is visible

- **Business objective:** Confirm the team member sees their own assignments
- **Persona:** Audit Team Member 2 (audit.auditor2)
- **Preconditions:** Procedures assigned
- **Test data:** -
- **Navigation:** Action Centre > My Work
- **Steps:** 1. Sign in as Audit Team Member 2. 2. Open assigned work.
- **Expected result:** Only assignments for this auditor are listed
- **Expected status:** Read-only pass
- **Expected notification:** No
- **Expected next user:** -
- **Security / SoD expectation:** No other auditor's work is shown
- **Evidence required:** Screenshot
- **Result:** NOT RUN (recorded in the execution report)

### IA-UAT-FLD-002 — Record an effective control test

- **Business objective:** Confirm a satisfactory test result can be recorded
- **Persona:** Audit Team Member 1 (audit.auditor1)
- **Preconditions:** Procedure assigned
- **Test data:** Effective result
- **Navigation:** Audits > engagement > Control Testing
- **Steps:** 1. Open the procedure. 2. Record sample, work performed and an effective conclusion. 3. Save.
- **Expected result:** Result and conclusion are recorded with performer and date
- **Expected status:** Completed
- **Expected notification:** No
- **Expected next user:** Reviewer
- **Security / SoD expectation:** -
- **Evidence required:** Screenshot
- **Result:** NOT RUN (recorded in the execution report)

### IA-UAT-FLD-003 — Record an ineffective control with exception

- **Business objective:** Confirm exceptions flow to findings
- **Persona:** Audit Team Member 1 (audit.auditor1)
- **Preconditions:** Procedure assigned
- **Test data:** Ineffective result
- **Navigation:** Audits > engagement > Control Testing
- **Steps:** 1. Record an ineffective conclusion with an exception description. 2. Save.
- **Expected result:** Exception is recorded and can be raised as a finding
- **Expected status:** Completed with exception
- **Expected notification:** No
- **Expected next user:** Lead Auditor
- **Security / SoD expectation:** -
- **Evidence required:** Screenshot
- **Result:** NOT RUN (recorded in the execution report)

### IA-UAT-FLD-004 — Fieldwork progress reflects work done

- **Business objective:** Confirm progress reporting is truthful
- **Persona:** Lead Auditor (audit.lead)
- **Preconditions:** Some tests complete
- **Test data:** -
- **Navigation:** Audits > engagement > Overview
- **Steps:** 1. Review the fieldwork progress indicator against completed procedures.
- **Expected result:** Progress corresponds to completed procedures
- **Expected status:** Fieldwork
- **Expected notification:** No
- **Expected next user:** -
- **Security / SoD expectation:** -
- **Evidence required:** Screenshot
- **Result:** NOT RUN (recorded in the execution report)


## Evidence & Working Papers

### IA-UAT-EVD-001 — Attach evidence and create a working paper

- **Business objective:** Confirm the evidence chain
- **Persona:** Audit Team Member 1 (audit.auditor1)
- **Preconditions:** Test recorded
- **Test data:** UAT evidence file
- **Navigation:** Audits > engagement > Evidence
- **Steps:** 1. Upload evidence with a description and date. 2. Link it to the test and to a working paper.
- **Expected result:** Evidence is stored with uploader, date, description and links
- **Expected status:** Saved
- **Expected notification:** No
- **Expected next user:** Reviewer
- **Security / SoD expectation:** Evidence is visible to the audit team only
- **Evidence required:** Screenshot of the evidence record
- **Result:** NOT RUN (recorded in the execution report)

### IA-UAT-EVD-002 — Evidence is mandatory where required

- **Business objective:** Confirm the negative case
- **Persona:** Audit Team Member 1 (audit.auditor1)
- **Preconditions:** Procedure requiring evidence
- **Test data:** -
- **Navigation:** Audits > engagement > Control Testing
- **Steps:** 1. Attempt to conclude a procedure that requires evidence without attaching any. 2. Attempt to attach evidence belonging to another engagement.
- **Expected result:** Both attempts are refused with a clear business message
- **Expected status:** Denied
- **Expected notification:** No
- **Expected next user:** -
- **Security / SoD expectation:** Cross-engagement evidence must be refused
- **Evidence required:** Screenshots of both refusals
- **Result:** NOT RUN (recorded in the execution report)


## Findings

### IA-UAT-FND-001 — Raise a finding

- **Business objective:** Confirm a complete finding can be recorded
- **Persona:** Audit Team Member 1 (audit.auditor1)
- **Preconditions:** Exception recorded
- **Test data:** UAT finding
- **Navigation:** Audits > engagement > Findings
- **Steps:** 1. Create a finding with condition, criteria, cause, effect and recommendation. 2. Set severity. 3. Save.
- **Expected result:** Finding is saved in draft with a reference
- **Expected status:** Draft
- **Expected notification:** No
- **Expected next user:** Lead Auditor
- **Security / SoD expectation:** Auditee cannot see draft findings
- **Evidence required:** Screenshot with finding reference
- **Result:** NOT RUN (recorded in the execution report)

### IA-UAT-FND-002 — Lead review and release

- **Business objective:** Confirm findings are reviewed before release
- **Persona:** Lead Auditor (audit.lead)
- **Preconditions:** Draft finding
- **Test data:** -
- **Navigation:** Audits > engagement > Findings
- **Steps:** 1. Review the draft finding. 2. Release it for management response with a response due date.
- **Expected result:** Finding becomes released and a response is requested
- **Expected status:** Released
- **Expected notification:** Yes - auditee management
- **Expected next user:** Auditee management
- **Security / SoD expectation:** Only the audit team may release
- **Evidence required:** Screenshot
- **Result:** NOT RUN (recorded in the execution report)

### IA-UAT-FND-003 — Severity change requires a rationale

- **Business objective:** Confirm the mandatory reason
- **Persona:** Lead Auditor (audit.lead)
- **Preconditions:** Released finding
- **Test data:** New severity
- **Navigation:** Findings > open finding
- **Steps:** 1. Change severity without a reason. 2. Change severity with a rationale.
- **Expected result:** The first attempt is refused; the second is applied and the previous severity is retained in history with actor and date
- **Expected status:** Amended
- **Expected notification:** Yes - auditee
- **Expected next user:** Auditee management
- **Security / SoD expectation:** Reason mandatory
- **Evidence required:** Screenshots of refusal and history
- **Result:** NOT RUN (recorded in the execution report)

### IA-UAT-FND-004 — Critical and high findings are prominent

- **Business objective:** Confirm severity visibility
- **Persona:** Head of Internal Audit (audit.hia)
- **Preconditions:** Findings exist
- **Test data:** -
- **Navigation:** Registers > Findings
- **Steps:** 1. Filter for high and critical findings.
- **Expected result:** High and critical findings are clearly identified and countable
- **Expected status:** Read-only pass
- **Expected notification:** No
- **Expected next user:** -
- **Security / SoD expectation:** -
- **Evidence required:** Screenshot
- **Result:** NOT RUN (recorded in the execution report)

### IA-UAT-FND-005 — Clean audit has no findings

- **Business objective:** Confirm UAT-A
- **Persona:** Lead Auditor (audit.lead)
- **Preconditions:** Clean engagement completed
- **Test data:** ENG-UAT clean
- **Navigation:** Audits > engagement > Findings
- **Steps:** 1. Complete the engagement with no exceptions. 2. Review the findings tab.
- **Expected result:** No findings exist and the engagement can still progress to reporting
- **Expected status:** Fieldwork complete
- **Expected notification:** No
- **Expected next user:** Quality Reviewer
- **Security / SoD expectation:** -
- **Evidence required:** Screenshot
- **Result:** NOT RUN (recorded in the execution report)


## Management Response

### IA-UAT-MRS-001 — Management sees the released finding

- **Business objective:** Confirm the auditee receives the finding
- **Persona:** Benefits Management / Auditee (audit.mgmt.benefits)
- **Preconditions:** Finding released
- **Test data:** -
- **Navigation:** Management workspace > Findings
- **Steps:** 1. Sign in as Benefits Management. 2. Open the finding.
- **Expected result:** Finding and response due date are visible
- **Expected status:** Response Requested
- **Expected notification:** Yes
- **Expected next user:** Auditee management
- **Security / SoD expectation:** Only the audited department sees it
- **Evidence required:** Screenshot
- **Result:** NOT RUN (recorded in the execution report)

### IA-UAT-MRS-002 — Submit an accepted response

- **Business objective:** Confirm the ordinary response path
- **Persona:** Benefits Management / Auditee (audit.mgmt.benefits)
- **Preconditions:** Finding released
- **Test data:** Accepted response
- **Navigation:** Management workspace > Findings > Respond
- **Steps:** 1. Record acceptance with an action commitment and target date. 2. Submit.
- **Expected result:** Response is recorded and the audit team is informed
- **Expected status:** Submitted
- **Expected notification:** Yes - audit team
- **Expected next user:** Lead Auditor
- **Security / SoD expectation:** -
- **Evidence required:** Screenshot
- **Result:** NOT RUN (recorded in the execution report)

### IA-UAT-MRS-003 — Return a response for clarification

- **Business objective:** Confirm the returned-response loop (UAT-C)
- **Persona:** Lead Auditor (audit.lead)
- **Preconditions:** Response submitted
- **Test data:** Return reason
- **Navigation:** Audits > engagement > Responses
- **Steps:** 1. Return the response with a reason. 2. Sign in as management and resubmit.
- **Expected result:** Return requires a reason, management is informed and the resubmission is versioned
- **Expected status:** Returned then Resubmitted
- **Expected notification:** Yes - both directions
- **Expected next user:** Auditee then audit team
- **Security / SoD expectation:** Reason mandatory
- **Evidence required:** Screenshots of both steps
- **Result:** NOT RUN (recorded in the execution report)

### IA-UAT-MRS-004 — Accept the response

- **Business objective:** Confirm acceptance closes the response step
- **Persona:** Lead Auditor (audit.lead)
- **Preconditions:** Response resubmitted
- **Test data:** -
- **Navigation:** Audits > engagement > Responses
- **Steps:** 1. Accept the response.
- **Expected result:** Response is accepted, history retained and corrective actions can be raised
- **Expected status:** Accepted
- **Expected notification:** Yes - auditee
- **Expected next user:** Auditee management
- **Security / SoD expectation:** -
- **Evidence required:** Screenshot
- **Result:** NOT RUN (recorded in the execution report)

### IA-UAT-MRS-005 — Management disagreement retained (UAT-D)

- **Business objective:** Confirm disagreement handling
- **Persona:** Compliance Management / Auditee (audit.mgmt.compliance)
- **Preconditions:** Finding released to Compliance
- **Test data:** Disagreement rationale
- **Navigation:** Management workspace > Findings > Respond
- **Steps:** 1. Disagree with the finding and supply a rationale. 2. As audit, retain the finding with the disagreement recorded and escalate.
- **Expected result:** Rationale is mandatory, both positions are retained and the disposition Retained with Disagreement is available
- **Expected status:** Retained with Disagreement
- **Expected notification:** Yes - both directions
- **Expected next user:** Head of Internal Audit
- **Security / SoD expectation:** Management cannot delete or amend the finding
- **Evidence required:** Screenshot of both positions
- **Result:** NOT RUN (recorded in the execution report)


## Corrective Actions

### IA-UAT-ACT-001 — Create a corrective action from a recommendation

- **Business objective:** Confirm traceability from the finding
- **Persona:** Lead Auditor (audit.lead)
- **Preconditions:** Response accepted
- **Test data:** UAT action
- **Navigation:** Audits > engagement > Actions
- **Steps:** 1. Create an action from the recommendation. 2. Set owner, department and target date. 3. Save.
- **Expected result:** Action is created and linked to the finding and recommendation
- **Expected status:** Open
- **Expected notification:** Yes - action owner
- **Expected next user:** Action owner
- **Security / SoD expectation:** -
- **Evidence required:** Screenshot with action reference
- **Result:** NOT RUN (recorded in the execution report)

### IA-UAT-ACT-002 — Owner receives the assignment

- **Business objective:** Confirm the owner is informed
- **Persona:** Benefits Management / Auditee (audit.mgmt.benefits)
- **Preconditions:** Action created
- **Test data:** -
- **Navigation:** Management workspace > Actions
- **Steps:** 1. Sign in as the owner. 2. Open the assignment notification and the action.
- **Expected result:** The assignment reaches the correct owner with a working link
- **Expected status:** Open
- **Expected notification:** Yes - Email and in-app
- **Expected next user:** Action owner
- **Security / SoD expectation:** Other departments are not informed
- **Evidence required:** Screenshot
- **Result:** NOT RUN (recorded in the execution report)

### IA-UAT-ACT-003 — Progress update

- **Business objective:** Confirm progress can be reported
- **Persona:** Benefits Management / Auditee (audit.mgmt.benefits)
- **Preconditions:** Action open
- **Test data:** Progress note
- **Navigation:** Management workspace > Actions
- **Steps:** 1. Record progress with a note and percentage. 2. Save.
- **Expected result:** Progress and history are recorded
- **Expected status:** In Progress
- **Expected notification:** No
- **Expected next user:** -
- **Security / SoD expectation:** -
- **Evidence required:** Screenshot
- **Result:** NOT RUN (recorded in the execution report)

### IA-UAT-ACT-004 — Extension requires a reason

- **Business objective:** Confirm the extension control
- **Persona:** Benefits Management / Auditee (audit.mgmt.benefits)
- **Preconditions:** Action open
- **Test data:** Extension request
- **Navigation:** Management workspace > Actions > Extend
- **Steps:** 1. Request an extension with no reason. 2. Request an extension with a valid reason and new date.
- **Expected result:** The first is refused; the second is submitted for independent approval
- **Expected status:** Extension Requested
- **Expected notification:** Yes - approver
- **Expected next user:** Approver
- **Security / SoD expectation:** Owner cannot approve their own extension
- **Evidence required:** Screenshots of both attempts
- **Result:** NOT RUN (recorded in the execution report)

### IA-UAT-ACT-005 — Extension approval keeps history

- **Business objective:** Confirm dates are auditable
- **Persona:** Lead Auditor (audit.lead)
- **Preconditions:** Extension requested
- **Test data:** -
- **Navigation:** Audits > engagement > Actions
- **Steps:** 1. Approve the extension.
- **Expected result:** Original target date is retained historically, the current date changes and the reason is kept
- **Expected status:** Extended
- **Expected notification:** Yes - owner
- **Expected next user:** Action owner
- **Security / SoD expectation:** Independent approver required
- **Evidence required:** Screenshot showing both dates
- **Result:** NOT RUN (recorded in the execution report)

### IA-UAT-ACT-006 — Overdue action and escalation (UAT-E)

- **Business objective:** Confirm chasing works
- **Persona:** Finance Management / Auditee (audit.mgmt.finance)
- **Preconditions:** Action past due
- **Test data:** Overdue action
- **Navigation:** Action Centre > Overdue
- **Steps:** 1. Review the overdue action. 2. Confirm reminder and escalation records.
- **Expected result:** Action shows overdue, the owner is reminded and escalation reaches the audit lead
- **Expected status:** Overdue
- **Expected notification:** Yes - owner then escalation
- **Expected next user:** Action owner then Lead Auditor
- **Security / SoD expectation:** -
- **Evidence required:** Screenshot and communication history
- **Result:** NOT RUN (recorded in the execution report)

### IA-UAT-ACT-007 — Management cannot verify its own action

- **Business objective:** Mandatory segregation of duties
- **Persona:** Benefits Management / Auditee (audit.mgmt.benefits)
- **Preconditions:** Action completed by management
- **Test data:** -
- **Navigation:** Management workspace > Actions
- **Steps:** 1. Submit completion with evidence. 2. Attempt to verify the action.
- **Expected result:** Completion is accepted, self-verification is refused
- **Expected status:** Denied
- **Expected notification:** No
- **Expected next user:** Audit verifier
- **Security / SoD expectation:** Self-verification forbidden
- **Evidence required:** Screenshot of refusal
- **Result:** NOT RUN (recorded in the execution report)

### IA-UAT-ACT-008 — Independent verification and closure

- **Business objective:** Confirm the audit team closes actions
- **Persona:** Audit Team Member 1 (audit.auditor1)
- **Preconditions:** Completion submitted
- **Test data:** Verification note
- **Navigation:** Audits > engagement > Actions
- **Steps:** 1. Review the evidence. 2. Reject once with a reason and let management resubmit. 3. Verify and close.
- **Expected result:** Rejection and resubmission are recorded and closure is only performed by the audit team
- **Expected status:** Closed
- **Expected notification:** Yes - owner
- **Expected next user:** Action owner
- **Security / SoD expectation:** Only audit may close
- **Evidence required:** Screenshots of rejection and closure
- **Result:** NOT RUN (recorded in the execution report)


## Reminders & Escalations

### IA-UAT-REM-001 — Due soon and due today reminders

- **Business objective:** Confirm timely chasing
- **Persona:** Finance Management / Auditee (audit.mgmt.finance)
- **Preconditions:** Action due shortly
- **Test data:** -
- **Navigation:** Management workspace and email
- **Steps:** 1. Review reminders for an action due soon and due today.
- **Expected result:** Correct recipient is reminded at the configured points and duplicates are not sent
- **Expected status:** Open
- **Expected notification:** Yes - owner
- **Expected next user:** Action owner
- **Security / SoD expectation:** Reminders go only to the responsible department
- **Evidence required:** Reminder history screenshot
- **Result:** NOT RUN (recorded in the execution report)

### IA-UAT-REM-002 — Escalation recipients

- **Business objective:** Confirm escalation routing
- **Persona:** Head of Internal Audit (audit.hia)
- **Preconditions:** Action overdue beyond threshold
- **Test data:** -
- **Navigation:** Action Centre > Escalations
- **Steps:** 1. Review escalation records for an overdue action.
- **Expected result:** Escalation reaches department head, Lead Auditor and the Head of Internal Audit in the configured order
- **Expected status:** Escalated
- **Expected notification:** Yes
- **Expected next user:** Head of Internal Audit
- **Security / SoD expectation:** -
- **Evidence required:** Screenshot
- **Result:** NOT RUN (recorded in the execution report)


## Quality Review

### IA-UAT-QAR-001 — Quality review assignment is visible

- **Business objective:** Confirm the reviewer can reach the engagement
- **Persona:** Quality Reviewer (audit.qa)
- **Preconditions:** Engagement ready for review
- **Test data:** -
- **Navigation:** Quality Review workspace
- **Steps:** 1. Sign in as the Quality Reviewer. 2. Open the assigned engagement, evidence and draft report.
- **Expected result:** The assigned engagement opens and its evidence and report are readable
- **Expected status:** Under QA
- **Expected notification:** Yes
- **Expected next user:** Quality Reviewer
- **Security / SoD expectation:** Reviewer must not be the engagement Lead
- **Evidence required:** Screenshot
- **Result:** NOT RUN (recorded in the execution report)

### IA-UAT-QAR-002 — Request rework (UAT-H)

- **Business objective:** Confirm rework loop
- **Persona:** Quality Reviewer (audit.qa)
- **Preconditions:** Engagement under review
- **Test data:** Rework reason
- **Navigation:** Quality Review > engagement
- **Steps:** 1. Complete the checklist. 2. Request rework with a reason. 3. As the Lead, revise and resubmit. 4. Re-review and clear.
- **Expected result:** Rework requires a reason, revision is recorded and the final review clears the engagement
- **Expected status:** QA Satisfactory
- **Expected notification:** Yes - Lead Auditor
- **Expected next user:** Lead Auditor
- **Security / SoD expectation:** -
- **Evidence required:** Screenshots of rework and clearance
- **Result:** NOT RUN (recorded in the execution report)

### IA-UAT-QAR-003 — Reviewer cannot perform audit work

- **Business objective:** Segregation of duties
- **Persona:** Quality Reviewer (audit.qa)
- **Preconditions:** Engagement under review
- **Test data:** -
- **Navigation:** Quality Review > engagement tabs
- **Steps:** 1. Attempt to edit the programme, record fieldwork, alter a management response and issue the report.
- **Expected result:** All four attempts are refused
- **Expected status:** Denied
- **Expected notification:** No
- **Expected next user:** -
- **Security / SoD expectation:** QA is review-only
- **Evidence required:** Screenshots of refusals
- **Result:** NOT RUN (recorded in the execution report)


## Draft & Final Report

### IA-UAT-RPT-001 — Draft report content reconciles

- **Business objective:** Confirm the report reflects the audit record
- **Persona:** Lead Auditor (audit.lead)
- **Preconditions:** Findings and responses complete
- **Test data:** -
- **Navigation:** Audits > engagement > Report
- **Steps:** 1. Generate the draft report. 2. Compare findings, responses and actions with the engagement tabs.
- **Expected result:** The draft matches current audit records with no placeholder content
- **Expected status:** Draft Report
- **Expected notification:** No
- **Expected next user:** Quality Reviewer
- **Security / SoD expectation:** -
- **Evidence required:** Screenshot of draft report
- **Result:** NOT RUN (recorded in the execution report)

### IA-UAT-RPT-002 — Issuance is blocked before quality clearance

- **Business objective:** Confirm the gate
- **Persona:** Lead Auditor (audit.lead)
- **Preconditions:** QA outstanding
- **Test data:** -
- **Navigation:** Audits > engagement > Report
- **Steps:** 1. Attempt to issue the final report while quality review is outstanding.
- **Expected result:** Issuance is refused with a clear reason
- **Expected status:** Denied
- **Expected notification:** No
- **Expected next user:** Quality Reviewer
- **Security / SoD expectation:** -
- **Evidence required:** Screenshot
- **Result:** NOT RUN (recorded in the execution report)

### IA-UAT-RPT-003 — Issue the final report

- **Business objective:** Confirm formal issuance and distribution
- **Persona:** Lead Auditor (audit.lead)
- **Preconditions:** QA satisfactory
- **Test data:** Final report
- **Navigation:** Audits > engagement > Report > Issue
- **Steps:** 1. Issue the final report to the auditee and the Head of Internal Audit.
- **Expected result:** Report is issued with version, issued date, issuer and recipients; the communicated version matches the issued version
- **Expected status:** Issued
- **Expected notification:** Yes - auditee and Head of Internal Audit
- **Expected next user:** Auditee management
- **Security / SoD expectation:** Only the audited department receives it
- **Evidence required:** Screenshot and communication history
- **Result:** NOT RUN (recorded in the execution report)


## Audit Closure

### IA-UAT-CLS-001 — Closure blocked with outstanding actions

- **Business objective:** Mandatory negative
- **Persona:** Head of Internal Audit (audit.hia)
- **Preconditions:** Report issued, actions open
- **Test data:** -
- **Navigation:** Audits > engagement > Closure
- **Steps:** 1. Attempt ordinary closure while corrective actions remain open.
- **Expected result:** Closure as Closed is refused and the blocking items are listed
- **Expected status:** Denied
- **Expected notification:** No
- **Expected next user:** -
- **Security / SoD expectation:** -
- **Evidence required:** Screenshot of blockers
- **Result:** NOT RUN (recorded in the execution report)

### IA-UAT-CLS-002 — Closed - Actions Pending

- **Business objective:** Confirm the alternative disposition
- **Persona:** Head of Internal Audit (audit.hia)
- **Preconditions:** Report issued, actions open
- **Test data:** -
- **Navigation:** Audits > engagement > Closure
- **Steps:** 1. Close the engagement as Closed - Actions Pending.
- **Expected result:** Engagement closes with the pending disposition recorded
- **Expected status:** Closed - Actions Pending
- **Expected notification:** Yes - auditee and team
- **Expected next user:** Action owners
- **Security / SoD expectation:** -
- **Evidence required:** Screenshot
- **Result:** NOT RUN (recorded in the execution report)

### IA-UAT-CLS-003 — Ordinary closure of the clean audit (UAT-A)

- **Business objective:** Confirm clean closure
- **Persona:** Head of Internal Audit (audit.hia)
- **Preconditions:** Clean engagement, report issued, QA cleared
- **Test data:** -
- **Navigation:** Audits > engagement > Closure
- **Steps:** 1. Close the engagement.
- **Expected result:** Engagement is Closed with closure date, closer and summary
- **Expected status:** Closed
- **Expected notification:** Yes
- **Expected next user:** Head of Internal Audit
- **Security / SoD expectation:** -
- **Evidence required:** Screenshot
- **Result:** NOT RUN (recorded in the execution report)


## Follow-Up

### IA-UAT-FUP-001 — Post-closure obligations remain live

- **Business objective:** Confirm closure does not erase obligations
- **Persona:** Benefits Management / Auditee (audit.mgmt.benefits)
- **Preconditions:** Engagement closed with actions pending
- **Test data:** -
- **Navigation:** Management workspace > Actions
- **Steps:** 1. After closure, open the outstanding action. 2. Update it and submit completion evidence.
- **Expected result:** The action remains active and can be progressed and verified after closure
- **Expected status:** Open after closure
- **Expected notification:** Yes
- **Expected next user:** Action owner then audit verifier
- **Security / SoD expectation:** -
- **Evidence required:** Screenshot
- **Result:** NOT RUN (recorded in the execution report)

### IA-UAT-FUP-002 — Follow-up review and outcome

- **Business objective:** Confirm independent follow-up
- **Persona:** Audit Team Member 2 (audit.auditor2)
- **Preconditions:** Action completed
- **Test data:** Follow-up record
- **Navigation:** Internal Audit > Follow-Up Tracker
- **Steps:** 1. Schedule a follow-up with owner and due date. 2. Record the outcome as Implemented. 3. Close the follow-up.
- **Expected result:** Follow-up is completed and no further reminders are produced
- **Expected status:** Implemented
- **Expected notification:** Yes - owner
- **Expected next user:** -
- **Security / SoD expectation:** Follow-up is performed by audit, not management
- **Evidence required:** Screenshot
- **Result:** NOT RUN (recorded in the execution report)


## Carry-Forward

### IA-UAT-CFW-001 — Carry an unfinished audit forward (UAT-I)

- **Business objective:** Confirm cross-year continuity
- **Persona:** Head of Internal Audit (audit.hia)
- **Preconditions:** Engagement unfinished at year end
- **Test data:** Next fiscal year plan
- **Navigation:** Annual Plan > Closeout > disposition
- **Steps:** 1. Mark the unfinished engagement as Carried Forward with a reason. 2. Open the next-year plan.
- **Expected result:** A successor engagement exists in the following year with visible lineage to the source year and engagement
- **Expected status:** Carried Forward
- **Expected notification:** Yes - Lead Auditor
- **Expected next user:** Lead Auditor
- **Security / SoD expectation:** -
- **Evidence required:** Screenshot of lineage
- **Result:** NOT RUN (recorded in the execution report)

### IA-UAT-CFW-002 — Carry-forward is not follow-up

- **Business objective:** Confirm the two concepts are distinct
- **Persona:** Head of Internal Audit (audit.hia)
- **Preconditions:** Carry-forward and follow-up both exist
- **Test data:** -
- **Navigation:** Follow-Up Tracker and Plan Closeout
- **Steps:** 1. Compare the carried-forward engagement with corrective action follow-ups.
- **Expected result:** The two are presented separately and are not conflated
- **Expected status:** Read-only pass
- **Expected notification:** No
- **Expected next user:** -
- **Security / SoD expectation:** -
- **Evidence required:** Screenshot
- **Result:** NOT RUN (recorded in the execution report)


## Annual Plan Closeout

### IA-UAT-PCL-001 — Plan closure precheck

- **Business objective:** Confirm the closure gate
- **Persona:** Head of Internal Audit (audit.hia)
- **Preconditions:** One engagement unfinished
- **Test data:** -
- **Navigation:** Annual Plan > Closeout
- **Steps:** 1. Attempt to close the annual plan while an engagement has no terminal disposition.
- **Expected result:** Closure is refused and the outstanding engagement is named
- **Expected status:** Denied
- **Expected notification:** No
- **Expected next user:** -
- **Security / SoD expectation:** -
- **Evidence required:** Screenshot
- **Result:** NOT RUN (recorded in the execution report)

### IA-UAT-PCL-002 — Close the annual plan

- **Business objective:** Confirm formal plan closure
- **Persona:** Head of Internal Audit (audit.hia)
- **Preconditions:** All engagements dispositioned
- **Test data:** -
- **Navigation:** Annual Plan > Closeout
- **Steps:** 1. Apply dispositions to all engagements. 2. Close the plan.
- **Expected result:** Plan is closed with summary, closer and date, and the history is immutable
- **Expected status:** Closed
- **Expected notification:** Yes - audit team
- **Expected next user:** -
- **Security / SoD expectation:** Only the Head of Internal Audit may close
- **Evidence required:** Screenshot of closure summary
- **Result:** NOT RUN (recorded in the execution report)


## Action Centre

### IA-UAT-ACC-001 — Action Centre queues for the audit team

- **Business objective:** Confirm the work queue is accurate
- **Persona:** Lead Auditor (audit.lead)
- **Preconditions:** Portfolio active
- **Test data:** -
- **Navigation:** Internal Audit > Action Centre
- **Steps:** 1. Review each tab and its count. 2. Drill into one record from each tab.
- **Expected result:** Counts match the listed records and drill-down opens the right record
- **Expected status:** Read-only pass
- **Expected notification:** No
- **Expected next user:** -
- **Security / SoD expectation:** -
- **Evidence required:** Screenshot of each tab
- **Result:** NOT RUN (recorded in the execution report)

### IA-UAT-ACC-002 — Action Centre for management

- **Business objective:** Confirm the auditee sees only its obligations
- **Persona:** Compliance Management / Auditee (audit.mgmt.compliance)
- **Preconditions:** Compliance obligations exist
- **Test data:** -
- **Navigation:** Management workspace > Action Centre
- **Steps:** 1. Review the queues as Compliance Management.
- **Expected result:** Only Compliance obligations are listed
- **Expected status:** Read-only pass
- **Expected notification:** No
- **Expected next user:** -
- **Security / SoD expectation:** No Benefits or Finance records
- **Evidence required:** Screenshot
- **Result:** NOT RUN (recorded in the execution report)


## Registers

### IA-UAT-REG-001 — Audit and finding registers

- **Business objective:** Confirm the registers are complete
- **Persona:** Head of Internal Audit (audit.hia)
- **Preconditions:** Portfolio active
- **Test data:** -
- **Navigation:** Internal Audit > Registers
- **Steps:** 1. Open the audit register and the finding register. 2. Apply filters and drill down.
- **Expected result:** Registers list the current portfolio, filters work and drill-down opens the record
- **Expected status:** Read-only pass
- **Expected notification:** No
- **Expected next user:** -
- **Security / SoD expectation:** -
- **Evidence required:** Screenshots
- **Result:** NOT RUN (recorded in the execution report)

### IA-UAT-REG-002 — Action, follow-up and carry-forward registers

- **Business objective:** Confirm the remaining registers
- **Persona:** Head of Internal Audit (audit.hia)
- **Preconditions:** Actions and follow-ups exist
- **Test data:** -
- **Navigation:** Internal Audit > Registers
- **Steps:** 1. Open the action, follow-up and carry-forward registers. 2. Check counts against the source screens.
- **Expected result:** Counts reconcile with the source screens
- **Expected status:** Read-only pass
- **Expected notification:** No
- **Expected next user:** -
- **Security / SoD expectation:** -
- **Evidence required:** Screenshots
- **Result:** NOT RUN (recorded in the execution report)


## Exports

### IA-UAT-EXP-001 — Export a register

- **Business objective:** Confirm exports reconcile
- **Persona:** Head of Internal Audit (audit.hia)
- **Preconditions:** Register loaded
- **Test data:** -
- **Navigation:** Registers > Export
- **Steps:** 1. Note the on-screen record count. 2. Export to CSV and to Excel.
- **Expected result:** Exported row count equals the on-screen count
- **Expected status:** Read-only pass
- **Expected notification:** No
- **Expected next user:** -
- **Security / SoD expectation:** -
- **Evidence required:** Screenshot and exported file
- **Result:** NOT RUN (recorded in the execution report)

### IA-UAT-EXP-002 — Filtered export and printable report

- **Business objective:** Confirm filtered output
- **Persona:** Head of Internal Audit (audit.hia)
- **Preconditions:** Filter applied
- **Test data:** Overdue only filter
- **Navigation:** Registers and Reports
- **Steps:** 1. Apply a filter and export. 2. Produce the printable or PDF version of a report.
- **Expected result:** The filtered export matches the filtered view and the printable output is legible
- **Expected status:** Read-only pass
- **Expected notification:** No
- **Expected next user:** -
- **Security / SoD expectation:** -
- **Evidence required:** Screenshot and file
- **Result:** NOT RUN (recorded in the execution report)


## Dashboard

### IA-UAT-DSH-001 — Head of Internal Audit dashboard

- **Business objective:** Confirm the dashboard is trustworthy
- **Persona:** Head of Internal Audit (audit.hia)
- **Preconditions:** Portfolio active
- **Test data:** -
- **Navigation:** Internal Audit > Dashboard
- **Steps:** 1. Review each indicator. 2. Compare with the corresponding register.
- **Expected result:** Every indicator reconciles with its source screen
- **Expected status:** Read-only pass
- **Expected notification:** No
- **Expected next user:** -
- **Security / SoD expectation:** -
- **Evidence required:** Screenshot with comparison
- **Result:** NOT RUN (recorded in the execution report)

### IA-UAT-DSH-002 — Management dashboard view

- **Business objective:** Confirm the auditee view
- **Persona:** Finance Management / Auditee (audit.mgmt.finance)
- **Preconditions:** Finance obligations exist
- **Test data:** -
- **Navigation:** Management workspace
- **Steps:** 1. Review the indicators as Finance Management.
- **Expected result:** Indicators cover Finance obligations only
- **Expected status:** Read-only pass
- **Expected notification:** No
- **Expected next user:** -
- **Security / SoD expectation:** No other department data
- **Evidence required:** Screenshot
- **Result:** NOT RUN (recorded in the execution report)


## Search & Filters

### IA-UAT-SCH2-001 — Search by business reference

- **Business objective:** Confirm records can be found by reference
- **Persona:** Lead Auditor (audit.lead)
- **Preconditions:** Records exist
- **Test data:** Engagement, finding, action references
- **Navigation:** Global or module search
- **Steps:** 1. Search by engagement reference, then finding reference, then action reference.
- **Expected result:** Each search returns the expected record
- **Expected status:** Read-only pass
- **Expected notification:** No
- **Expected next user:** -
- **Security / SoD expectation:** -
- **Evidence required:** Screenshot
- **Result:** NOT RUN (recorded in the execution report)

### IA-UAT-SCH2-002 — Filter combinations

- **Business objective:** Confirm filters behave
- **Persona:** Head of Internal Audit (audit.hia)
- **Preconditions:** Portfolio active
- **Test data:** Year, department, severity, status, overdue
- **Navigation:** Registers
- **Steps:** 1. Apply year, department, severity, status and overdue filters in combination.
- **Expected result:** Results narrow correctly and counts update
- **Expected status:** Read-only pass
- **Expected notification:** No
- **Expected next user:** -
- **Security / SoD expectation:** -
- **Evidence required:** Screenshot
- **Result:** NOT RUN (recorded in the execution report)


## Communication (Email / In-App)

### IA-UAT-COM-001 — Representative live email set

- **Business objective:** Confirm real delivery for key business events
- **Persona:** Lead Auditor (audit.lead)
- **Preconditions:** Email pilot active within caps
- **Test data:** Intimation, information request, response requested, action assignment, overdue, final report, follow-up
- **Navigation:** Communication history and mailbox
- **Steps:** 1. Trigger the representative business events across Benefits, Compliance and Finance. 2. Confirm receipt.
- **Expected result:** Each event produces the expected email to the expected recipient within release caps
- **Expected status:** Sent
- **Expected notification:** Yes
- **Expected next user:** Respective recipients
- **Security / SoD expectation:** No cross-department delivery
- **Evidence required:** Communication log screenshot
- **Result:** NOT RUN (recorded in the execution report)

### IA-UAT-COM-002 — Communication history for the auditor

- **Business objective:** Confirm the auditor can review the conversation
- **Persona:** Lead Auditor (audit.lead)
- **Preconditions:** Communications issued
- **Test data:** -
- **Navigation:** Audits > engagement > Communications
- **Steps:** 1. Review schedule, request, query, finding, response, action, report and follow-up communications.
- **Expected result:** A complete business communication history is available
- **Expected status:** Read-only pass
- **Expected notification:** No
- **Expected next user:** -
- **Security / SoD expectation:** -
- **Evidence required:** Screenshot
- **Result:** NOT RUN (recorded in the execution report)

### IA-UAT-COM-003 — No cross-department leakage

- **Business objective:** Mandatory confidentiality test
- **Persona:** Finance Management / Auditee (audit.mgmt.finance)
- **Preconditions:** Communications issued to all three departments
- **Test data:** -
- **Navigation:** Management workspace > Communications
- **Steps:** 1. As Finance Management review the communication list. 2. Repeat as Benefits and Compliance.
- **Expected result:** Each department sees only its own communications
- **Expected status:** Read-only pass
- **Expected notification:** No
- **Expected next user:** -
- **Security / SoD expectation:** Strict department isolation
- **Evidence required:** Screenshots for all three
- **Result:** NOT RUN (recorded in the execution report)


## Role / Permission / SoD Negatives

### IA-UAT-SEC-001 — Lead cannot approve the plan they prepared

- **Business objective:** Segregation of duties
- **Persona:** Lead Auditor (audit.lead)
- **Preconditions:** Plan submitted by the Lead
- **Test data:** -
- **Navigation:** Plan approval screen and direct address
- **Steps:** 1. Open the plan approval screen from the menu and by direct address. 2. Attempt approval.
- **Expected result:** Approval is refused
- **Expected status:** Denied
- **Expected notification:** No
- **Expected next user:** -
- **Security / SoD expectation:** Preparer cannot approve
- **Evidence required:** Screenshot
- **Result:** NOT RUN (recorded in the execution report)

### IA-UAT-SEC-002 — Team member cannot approve a plan

- **Business objective:** Segregation of duties
- **Persona:** Audit Team Member 1 (audit.auditor1)
- **Preconditions:** Plan submitted
- **Test data:** -
- **Navigation:** Direct navigation to plan approval
- **Steps:** 1. Enter the plan approval address directly.
- **Expected result:** Access is refused
- **Expected status:** Denied
- **Expected notification:** No
- **Expected next user:** -
- **Security / SoD expectation:** -
- **Evidence required:** Screenshot
- **Result:** NOT RUN (recorded in the execution report)

### IA-UAT-SEC-003 — Lead cannot quality review own engagement

- **Business objective:** Segregation of duties
- **Persona:** Lead Auditor (audit.lead)
- **Preconditions:** Engagement led by this user
- **Test data:** -
- **Navigation:** Quality review screen
- **Steps:** 1. Attempt to record a quality review outcome on the own engagement.
- **Expected result:** The action is refused
- **Expected status:** Denied
- **Expected notification:** No
- **Expected next user:** -
- **Security / SoD expectation:** -
- **Evidence required:** Screenshot
- **Result:** NOT RUN (recorded in the execution report)

### IA-UAT-SEC-004 — Quality Reviewer cannot perform fieldwork

- **Business objective:** Segregation of duties
- **Persona:** Quality Reviewer (audit.qa)
- **Preconditions:** Engagement in fieldwork
- **Test data:** -
- **Navigation:** Direct navigation to control testing
- **Steps:** 1. Attempt to record a control test result.
- **Expected result:** The action is refused
- **Expected status:** Denied
- **Expected notification:** No
- **Expected next user:** -
- **Security / SoD expectation:** -
- **Evidence required:** Screenshot
- **Result:** NOT RUN (recorded in the execution report)

### IA-UAT-SEC-005 — Quality Reviewer cannot issue the final report

- **Business objective:** Segregation of duties
- **Persona:** Quality Reviewer (audit.qa)
- **Preconditions:** QA satisfactory
- **Test data:** -
- **Navigation:** Engagement report tab
- **Steps:** 1. Attempt to issue the report.
- **Expected result:** The action is refused
- **Expected status:** Denied
- **Expected notification:** No
- **Expected next user:** -
- **Security / SoD expectation:** -
- **Evidence required:** Screenshot
- **Result:** NOT RUN (recorded in the execution report)

### IA-UAT-SEC-006 — Management cannot modify a finding

- **Business objective:** Confidentiality and integrity
- **Persona:** Benefits Management / Auditee (audit.mgmt.benefits)
- **Preconditions:** Finding released
- **Test data:** -
- **Navigation:** Management workspace > Findings
- **Steps:** 1. Attempt to edit the finding text or severity.
- **Expected result:** Only responding is possible; editing is refused
- **Expected status:** Denied
- **Expected notification:** No
- **Expected next user:** -
- **Security / SoD expectation:** -
- **Evidence required:** Screenshot
- **Result:** NOT RUN (recorded in the execution report)

### IA-UAT-SEC-007 — Management cannot see auditor working papers

- **Business objective:** Confidentiality
- **Persona:** Benefits Management / Auditee (audit.mgmt.benefits)
- **Preconditions:** Working papers exist
- **Test data:** -
- **Navigation:** Direct navigation to working papers
- **Steps:** 1. Enter the working papers address directly.
- **Expected result:** Access is refused or redirected to a safe page
- **Expected status:** Denied
- **Expected notification:** No
- **Expected next user:** -
- **Security / SoD expectation:** -
- **Evidence required:** Screenshot
- **Result:** NOT RUN (recorded in the execution report)

### IA-UAT-SEC-008 — Management cannot see another department's records

- **Business objective:** Confidentiality
- **Persona:** Compliance Management / Auditee (audit.mgmt.compliance)
- **Preconditions:** Benefits records exist
- **Test data:** Benefits engagement reference
- **Navigation:** Direct navigation to a Benefits engagement
- **Steps:** 1. Enter a Benefits engagement address directly as Compliance Management.
- **Expected result:** Access is refused and no Benefits data is displayed
- **Expected status:** Denied
- **Expected notification:** No
- **Expected next user:** -
- **Security / SoD expectation:** -
- **Evidence required:** Screenshot
- **Result:** NOT RUN (recorded in the execution report)

### IA-UAT-SEC-009 — Management cannot self-verify a corrective action

- **Business objective:** Segregation of duties
- **Persona:** Finance Management / Auditee (audit.mgmt.finance)
- **Preconditions:** Action completed
- **Test data:** -
- **Navigation:** Management workspace > Actions
- **Steps:** 1. Attempt verification.
- **Expected result:** The action is refused
- **Expected status:** Denied
- **Expected notification:** No
- **Expected next user:** -
- **Security / SoD expectation:** -
- **Evidence required:** Screenshot
- **Result:** NOT RUN (recorded in the execution report)

### IA-UAT-SEC-010 — Audit Administrator cannot act as Head of Internal Audit

- **Business objective:** Authority boundary
- **Persona:** Audit System Administrator (audit.admin)
- **Preconditions:** Plan submitted
- **Test data:** -
- **Navigation:** Direct navigation to plan approval and closure
- **Steps:** 1. Attempt plan approval and engagement closure.
- **Expected result:** Both are refused
- **Expected status:** Denied
- **Expected notification:** No
- **Expected next user:** -
- **Security / SoD expectation:** -
- **Evidence required:** Screenshot
- **Result:** NOT RUN (recorded in the execution report)

### IA-UAT-SEC-011 — Unauthenticated access is refused

- **Business objective:** Perimeter security
- **Persona:** Unauthenticated visitor
- **Preconditions:** Signed out
- **Test data:** -
- **Navigation:** Direct navigation to audit addresses
- **Steps:** 1. Open audit dashboard, engagement, findings and action centre addresses without signing in.
- **Expected result:** All requests are redirected to sign-in with no audit data displayed
- **Expected status:** Denied
- **Expected notification:** No
- **Expected next user:** -
- **Security / SoD expectation:** -
- **Evidence required:** Screenshot
- **Result:** NOT RUN (recorded in the execution report)

### IA-UAT-SEC-012 — Closed plan cannot be casually amended

- **Business objective:** Record integrity
- **Persona:** Lead Auditor (audit.lead)
- **Preconditions:** Plan closed
- **Test data:** -
- **Navigation:** Annual Plan
- **Steps:** 1. Attempt to add an engagement or change the closed plan.
- **Expected result:** The change is refused and the closed record remains intact
- **Expected status:** Denied
- **Expected notification:** No
- **Expected next user:** -
- **Security / SoD expectation:** -
- **Evidence required:** Screenshot
- **Result:** NOT RUN (recorded in the execution report)


## User Manual Alignment & Usability

### IA-UAT-USM-001 — Live system matches the user manual

- **Business objective:** Documentation alignment
- **Persona:** Lead Auditor (audit.lead)
- **Preconditions:** User manual available
- **Test data:** docs/audit/user-manual
- **Navigation:** Internal Audit > User Manuals
- **Steps:** 1. Follow the manual's planning, fieldwork and closure procedures step by step in the live system. 2. Compare navigation, labels and screenshots.
- **Expected result:** Navigation, labels, workflow and statuses match the manual; differences are recorded as documentation defects
- **Expected status:** Read-only pass
- **Expected notification:** No
- **Expected next user:** -
- **Security / SoD expectation:** -
- **Evidence required:** Manual section and screen comparison
- **Result:** NOT RUN (recorded in the execution report)

### IA-UAT-USM-002 — Business usability review

- **Business objective:** Usability acceptance
- **Persona:** Head of Internal Audit (audit.hia)
- **Preconditions:** Portfolio active
- **Test data:** -
- **Navigation:** Across the module
- **Steps:** 1. Review labels, statuses, buttons, empty states, loading states, error messages, required-field indication, date format and table readability.
- **Expected result:** A business user can operate the module without technical assistance; usability issues are logged separately from functional failures
- **Expected status:** Read-only pass
- **Expected notification:** No
- **Expected next user:** -
- **Security / SoD expectation:** -
- **Evidence required:** Notes and screenshots
- **Result:** NOT RUN (recorded in the execution report)
