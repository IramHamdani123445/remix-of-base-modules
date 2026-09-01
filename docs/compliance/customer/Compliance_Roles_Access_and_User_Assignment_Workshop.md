# Compliance & Enforcement
## Roles, Access and User Assignment — Customer Workshop and Decision Pack

**Prepared for:** Social Security Board — Compliance & Enforcement, Finance, Legal, and IT/Security Administration
**Purpose:** To agree the Compliance user access model before production configuration
**Document status:** For customer review, completion and approval
**Version:** 1.0

---

## 1. Purpose of This Document

This document explains, in plain business language, how user access works in the Compliance & Enforcement module and asks you to confirm how your own team should be set up.

It is intended to be:

1. **Read** by Compliance management, Finance, Legal and IT/Security;
2. **Discussed** in a working session;
3. **Completed** by your team (the questionnaires and worksheets); and
4. **Approved** as the agreed access model for production.

No access will be configured in the production environment until the decisions in Section 14 are confirmed by you.

**Please note:** this document asks you what your people *do in the process*, not only what their HR job titles are. The two are related but not the same thing.

---

## 2. The Six Concepts You Need to Distinguish

Access in the system is not a single setting. It is the result of six separate things working together. Confusing them is the most common cause of access problems, so they are defined here first.

| # | Concept | Plain-language meaning | Example |
|---|---|---|---|
| 1 | **User** | One named person with one login account. Accounts are personal and are never shared. | Mary Johnson |
| 2 | **Job Title / Designation** | The person's position in your organisation chart. This is HR information. It does **not**, by itself, grant any access. | Senior Compliance Officer |
| 3 | **Role** | A named bundle of system responsibilities. A role is what the person is authorised to *do* in the process. | Senior Inspector |
| 4 | **Permission** | An individual authorised action inside the system (for example, "approve a field report"). Permissions are grouped into roles; they are not normally granted one by one. | Approve inspection reports |
| 5 | **Organisational / Data Scope** | *Which records* the person may see and work on — the whole organisation, one office, one zone, an assigned employer portfolio, a queue, or only their own work. | Nevis office only |
| 6 | **Workflow Responsibility** | The person's position in an approval chain — who prepares, who reviews, who approves, who is escalated to. | Approves weekly field plans for their team |

**Key point:** a role decides *what a person may do*; scope decides *on whose records*; workflow decides *at which step*. These are configured separately and must be answered separately in the questionnaires below.

---

## 3. One User May Hold More Than One Role

The system **supports assigning more than one role to the same user account.** This is a supported, standard capability — not a workaround.

It is equally important to state the opposite:

- **Multiple roles are optional, not mandatory.**
- Many users will correctly have exactly **one** role.
- Roles should be assigned according to the responsibilities the person genuinely performs — no more.

### 3.1 Worked example

Mary principally works as a **Compliance Inspector**. She carries out inspections, records findings and raises violations.

Separately, your organisation also authorises Mary to produce the monthly Compliance management report pack. That is a different responsibility, so a second role — **Compliance Reports Viewer** — may be added to the same user account.

Mary now has one login, two roles, and the combined set of authorised activities that those two roles provide.

If Mary did **not** produce reports, she would simply hold the Inspector role alone.

### 3.2 How effective access is worked out

```text
                        USER
                (one person, one login)
                          |
        +-----------------+-----------------+
        |                                   |
   PRIMARY ROLE                   OPTIONAL ADDITIONAL ROLE(S)
 (main responsibility)         (only if genuinely performed)
        |                                   |
        +-----------------+-----------------+
                          |
                 EFFECTIVE PERMISSIONS
        (the combined authorised activities of all
         roles held; the wider of the two applies)
                          |
        +-----------------+-----------------+
        |                 |                 |
  DATA / ORGANISATIONAL   |          WORKFLOW
        SCOPE             |       RESPONSIBILITIES
 (which records)          |      (prepare / review /
                          |        approve / escalate)
                          |
                 WHAT THE USER
              ACTUALLY SEES AND CAN DO
```

Rules that follow from this diagram:

1. Where a user holds several roles, the **wider** authority applies. Roles add to each other; they do not cancel each other out.
2. Because roles add up, **combinations must be reviewed before approval** — see Sections 6 and 7.
3. Where governance requires it, an **exception may be recorded against an individual user** to grant or withhold a specific activity. This facility exists and is auditable, but it should be used sparingly; well-designed roles are always preferable.

---

## 4. A Role Is Not a Job Title

Your organisation chart and your system roles do not have to match one for one.

| Organisational job title (HR) | Possible system role(s) | Why |
|---|---|---|
| Senior Compliance Officer | Senior Inspector **+** Compliance Reports Viewer (if reporting is genuinely part of the job) | The person supervises field work *and* produces management information |
| Compliance Officer | Compliance Inspector | Single operational responsibility |
| Head of Compliance | Compliance Head | Oversight and approval authority |
| Compliance Support Officer | Compliance Reports Viewer | Information access only, no processing authority |
| Systems Officer (Compliance) | Compliance Admin | Configures the Compliance module; is **not** a whole-system administrator |

**What we need from you:** for each category of staff, please tell us **what the person does in the process** (prepares, reviews, approves, configures, reports), not only their HR title. Section 8 provides the worksheet for this.

---

## 5. A Role Is Not a Data Scope

A role does **not** need to be duplicated for each location. The same role can be reused across offices and zones, with the *scope* deciding which records the person sees.

| Role | Possible scope options |
|---|---|
| Compliance Inspector | Entire organisation · one office · one compliance zone · an assigned employer portfolio · an assigned work queue · only their own inspections and cases |
| Senior Inspector | Their own work plus their subordinate officers' work · one office · one zone |
| Compliance Head | Entire Compliance population (enterprise view) |
| Compliance Finance User | All employer financial records · or only records for a defined office/zone |
| Compliance Legal Officer | Only matters escalated to Legal · or all Compliance records |
| Compliance Reports Viewer | Enterprise reports · or reports limited to one office/zone |

**We therefore recommend against** creating roles such as *"Basseterre Inspector"*, *"Charlestown Inspector"* or *"Zone A Inspector"*. One **Compliance Inspector** role, plus the correct office/zone scope, achieves the same result and is far simpler to administer over time.

Section 11 asks you to specify the intended scope for each category of user.

---

## 6. The Compliance Roles Available Today

The following roles exist in the Compliance & Enforcement module and were verified against the current build.

### 6.1 Global System Administrator vs Compliance Administrator

This distinction matters and should be settled early.

| | **Global System Administrator** | **Compliance Admin** |
|---|---|---|
| Authority | The entire application — every module, every organisation-wide setting, all user administration | The Compliance & Enforcement domain only |
| Typical holder | IT / Security administration | A Compliance systems or business-administration officer |
| Compliance configuration | Yes | Yes |
| Configuration of unrelated modules (Benefits, Registration, Internal Audit, Finance) | Yes | No |
| Recommendation | Restrict to a small number of IT/Security staff | **Use this for normal Compliance administration** |

**Recommendation:** Compliance personnel who need to administer Compliance settings should be given **Compliance Admin**, not global System Administration. Global System Administration should remain with IT/Security and should be limited to the minimum number of individuals your security policy permits.

### 6.2 Role catalogue — business descriptions

| Role | Business Purpose | Typical User | Main Responsibilities | Can Initiate | Can Review | Can Approve | Reports | Administration | Notes |
|---|---|---|---|:-:|:-:|:-:|:-:|:-:|---|
| **Compliance Admin** | Administration and configuration of the Compliance domain | Compliance systems / business administration officer | Compliance setup, rules, templates, geography, zones, queues, officer records, automation, numbering | △ (configuration items) | △ | △ (configuration only) | ✔ | ✔ Compliance only | Should **not** be given whole-application system administration |
| **Compliance Head** | Overall management of Compliance and Enforcement | Head / Manager of Compliance | Enterprise oversight, management dashboards, approvals, escalations, waivers, overrides, workload and performance monitoring | ✔ | ✔ | ✔ (broad) | ✔ | △ | Currently holds the widest operational authority in the module — please confirm this is intended (Decision ROLE-02) |
| **Senior Inspector** | Supervision of field and case work | Supervisor / Senior Compliance Officer | Reviews and approves field plans and inspection reports, sampling, team workbench, case and violation supervision, arrangement and partial-payment approval, legal recommendation approval | ✔ | ✔ | ✔ (operational, within team) | ✔ Operational | — | May also carry out field work where your operating model requires it |
| **Compliance Inspector** | Day-to-day Compliance execution | Compliance Officer / Field Inspector | Field visits, evidence, findings, violations, case creation and management, enforcement notices, partial-payment requests, operational reporting | ✔ | △ | — | ✔ Operational | — | Prepares work for supervisory approval; does not approve their own output |
| **Compliance Finance User** | Finance-related Compliance responsibilities | Finance Officer supporting Compliance | Payment allocation, instalment and breach review, arrears information and related reporting | △ (finance items) | △ | — | ✔ Finance-related | — | Deliberately narrow — **cannot** create or approve general Compliance work such as violations and cases |
| **Compliance Legal Officer** | Legal escalation and proceedings | Legal Officer | Legal referral queue, legal review, proceedings management, legal dashboard, legal outcomes | △ (legal items) | ✔ (legal) | △ (legal only, where configured) | ✔ Legal | — | Deliberately narrow — does **not** receive general Compliance approval authority |
| **Compliance Reports Viewer** | Management information | Reporting / MI officer, management support | Views and exports authorised dashboards and reports | — | — | — | ✔ | — | No transactional processing authority whatsoever |
| **Read Only** | Restricted observer | Auditor, observer, temporary access | Restricted read access only | — | — | — | △ | — | In the current build this persona is denied the Compliance operational screens by design |

**Legend:** ✔ Full / normal · △ Limited or specific · — Not applicable

---

## 7. Assigning More Than One Role to a User

Where an employee genuinely performs several functions, roles may be combined. Because the resulting user receives the combined authorised activities of every role held, each combination must be considered deliberately.

**Classification used below:**

- **Normally Acceptable** — no governance concern expected
- **Requires Customer Confirmation** — workable, but you must confirm the working model
- **Potential Segregation-of-Duties Conflict** — creates a risk that one person both prepares and approves the same item
- **Normally Avoid** — concentrates authority to a degree most organisations would not accept

| Employee situation | Possible role combination | Classification | Customer decision required | Governance concern |
|---|---|---|---|---|
| Officer performing normal inspections only | Compliance Inspector | Normally Acceptable | Confirm | Low |
| Supervisor who also performs field work personally | Senior Inspector (single role) | Requires Customer Confirmation | Confirm your actual working model | Supervisor may end up approving work they carried out themselves |
| Compliance manager | Compliance Head | Normally Acceptable | Confirm approval authority | Concentration of approval authority |
| Finance staff assisting Compliance | Compliance Finance User | Normally Acceptable | Confirm the exact finance activities intended | Payment / reconciliation separation |
| Legal staff handling escalations | Compliance Legal Officer | Normally Acceptable | Confirm legal approval authority | Legal approval boundary |
| Management information user | Compliance Reports Viewer | Normally Acceptable | Confirm which reports may be seen | Sensitive employer and personal information |
| Officer performing both Compliance and Finance functions | Compliance Inspector **+** Compliance Finance User | Potential Segregation-of-Duties Conflict | Explicit approval required | Maker–checker on payments and arrangements |
| Supervisor also acting as reporting officer | Senior Inspector **+** Compliance Reports Viewer | Normally Acceptable | Confirm report visibility | Low |
| Manager also acting as Legal approver | Compliance Head **+** Compliance Legal Officer | Potential Segregation-of-Duties Conflict | Explicit approval required | One person recommends and approves legal escalation |
| Compliance manager also administering Compliance configuration | Compliance Head **+** Compliance Admin | Requires Customer Confirmation | Explicit approval required | Configures the rules that govern transactions they later approve |
| Inspector also administering Compliance configuration | Compliance Inspector **+** Compliance Admin | Normally Avoid | — | Operational user able to change the rules applied to their own work |
| Any Compliance user given global System Administration | Compliance role **+** Global System Administrator | Normally Avoid | — | Unrestricted access far beyond Compliance |

**These are illustrations, not instructions.** None of the combinations above is mandatory, and you may propose combinations not listed here.

---

## 8. Why Some Role Combinations Need Special Review

The system supports workflow and maker–checker controls: work can be prepared by one person and approved by another, and every approval is recorded. Whether a particular separation is *enforced* is a business policy decision that only you can make.

Please answer each question below.

**Answer options:** **Yes** · **No** · **Only with specific authority** · **Not applicable**

| # | Should the same person be permitted to… | Yes | No | Only with specific authority | N/A | Customer comments |
|---|---|:-:|:-:|:-:|:-:|---|
| SoD-01 | Create a weekly field plan **and** approve that same plan | ☐ | ☐ | ☐ | ☐ | |
| SoD-02 | Prepare an inspection / field report **and** approve that same report | ☐ | ☐ | ☐ | ☐ | |
| SoD-03 | Raise a violation **and** approve its final resolution | ☐ | ☐ | ☐ | ☐ | |
| SoD-04 | Create a case **and** approve closure of that case | ☐ | ☐ | ☐ | ☐ | |
| SoD-05 | Initiate a payment arrangement **and** approve it | ☐ | ☐ | ☐ | ☐ | |
| SoD-06 | Request a partial-payment action **and** approve it | ☐ | ☐ | ☐ | ☐ | |
| SoD-07 | Prepare an enforcement notice **and** authorise its issuance | ☐ | ☐ | ☐ | ☐ | |
| SoD-08 | Recommend legal escalation **and** approve that legal escalation | ☐ | ☐ | ☐ | ☐ | |
| SoD-09 | Prepare a legal matter **and** approve the legal outcome | ☐ | ☐ | ☐ | ☐ | |
| SoD-10 | Configure Compliance rules **and** subsequently approve transactions affected by those rules | ☐ | ☐ | ☐ | ☐ | |
| SoD-11 | Configure risk / scoring rules **and** override the resulting scores | ☐ | ☐ | ☐ | ☐ | |
| SoD-12 | Reassign work to another officer **and** subsequently approve that officer's output | ☐ | ☐ | ☐ | ☐ | |

Where you answer **"Only with specific authority"**, please state which position holds that authority (for example, "Head of Compliance only, with written justification recorded").

---

## 9. Customer Organisation Questionnaire

### Section A — Compliance Team Structure

| # | Question | Customer answer |
|---|---|---|
| A-01 | How many Compliance employees will use the system? | |
| A-02 | What are their job titles, and how many people hold each title? | |
| A-03 | Which offices do they belong to? | |
| A-04 | Is Compliance centralised in one office, or distributed across offices? | |
| A-05 | Are officers assigned geographically (by zone/district)? If so, list the zones. | |
| A-06 | Are officers allocated permanent employer portfolios? | |
| A-07 | Or are assignments made dynamically through work queues? | |
| A-08 | Or is it a combination of both? Please describe. | |
| A-09 | Who supervises each group of officers? | |
| A-10 | Who is the Head of Compliance? | |
| A-11 | Are Finance personnel part of the Compliance department, or a separate department? | |
| A-12 | Are Legal personnel part of the Compliance department, or a separate department? | |
| A-13 | Are there staff who work part-time in Compliance and part-time elsewhere? | |
| A-14 | Are temporary, seconded or contract staff expected to need access? | |

### Section B — Operational Responsibility

For each activity, please state which job title or team **performs**, **reviews**, **approves**, may **reassign** and may **override**.

| # | Activity | Performs? | Reviews? | Approves? | Can reassign? | Can override? | Which team / job title? |
|---|---|---|---|---|---|---|---|
| B-01 | Employer monitoring | | | | | | |
| B-02 | Risk review | | | | | | |
| B-03 | Inspection planning | | | | | | |
| B-04 | Inspection assignment | | | | | | |
| B-05 | Field inspections | | | | | | |
| B-06 | Evidence capture | | | | | | |
| B-07 | Findings | | | | | | |
| B-08 | Violations | | | | | | |
| B-09 | Case creation | | | | | | |
| B-10 | Case management | | | | | | |
| B-11 | Enforcement notices | | | | | | |
| B-12 | Payment arrangements | | | | | | |
| B-13 | Breach monitoring | | | | | | |
| B-14 | Penalties | | | | | | |
| B-15 | Waivers / overrides | | | | | | |
| B-16 | Legal referrals | | | | | | |
| B-17 | Legal proceedings | | | | | | |
| B-18 | Reporting | | | | | | |
| B-19 | Analytics | | | | | | |
| B-20 | Rule configuration | | | | | | |
| B-21 | Risk / scoring configuration | | | | | | |
| B-22 | Templates | | | | | | |
| B-23 | Communication configuration | | | | | | |
| B-24 | Queue management | | | | | | |
| B-25 | User and role administration for Compliance | | | | | | |

---

## 10. User / Role Mapping Worksheet

Please complete one row per **position or category of staff**. **Personal names are not required at this stage** — positions and categories are sufficient (for example: *Head of Compliance*, *Senior Compliance Officer*, *Inspector*, *Field Inspector*, *Finance Officer*, *Legal Officer*, *Reporting Officer*). Names can be supplied later, before configuration.

Leave "Additional Role" columns blank where a single role is sufficient.

| # | Employee / Position | Job Title | Department | Office / Zone | Primary Role | Additional Role 1 | Additional Role 2 | Supervisor | Data Scope | Approval Authority | Comments |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | | | | | | | | | | | |
| 2 | | | | | | | | | | | |
| 3 | | | | | | | | | | | |
| 4 | | | | | | | | | | | |
| 5 | | | | | | | | | | | |
| 6 | | | | | | | | | | | |
| 7 | | | | | | | | | | | |
| 8 | | | | | | | | | | | |
| 9 | | | | | | | | | | | |
| 10 | | | | | | | | | | | |
| 11 | | | | | | | | | | | |
| 12 | | | | | | | | | | | |
| 13 | | | | | | | | | | | |
| 14 | | | | | | | | | | | |
| 15 | | | | | | | | | | | |
| 16 | | | | | | | | | | | |
| 17 | | | | | | | | | | | |
| 18 | | | | | | | | | | | |
| 19 | | | | | | | | | | | |
| 20 | | | | | | | | | | | |
| 21 | | | | | | | | | | | |
| 22 | | | | | | | | | | | |
| 23 | | | | | | | | | | | |
| 24 | | | | | | | | | | | |
| 25 | | | | | | | | | | | |

---

## 11. Role-by-Function Decision Matrix (Current Baseline)

The table below shows how the system behaves **today**, as verified in the current build and persona certification. Please mark any change you require in the final two columns.

**Legend:** ✔ Full / normal access · △ Limited or specific access · R Read-only · — No access · ? Customer decision required

| Function area | Compliance Admin | Compliance Head | Senior Inspector | Compliance Inspector | Compliance Finance User | Compliance Legal Officer | Compliance Reports Viewer | Read Only | Customer proposed change | Customer comments |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|---|
| Dashboard | ✔ | ✔ | ✔ | ✔ | △ | △ | R | — | | |
| My Work Queue | △ | ✔ | ✔ | ✔ | △ | △ | — | — | | |
| Violations | △ | ✔ | ✔ | ✔ | — | R | — | — | | |
| Cases | △ | ✔ | ✔ | ✔ | — | △ | — | — | | |
| Notices | △ | ✔ | ✔ | ✔ | — | R | — | — | | |
| Payment Arrangements | △ | ✔ | ✔ | △ (request only) | ✔ | — | — | — | | |
| Inspections / Field Work | △ | ✔ | ✔ | ✔ | — | — | — | — | | |
| Legal Escalations | △ | ✔ | ✔ | △ (refer only) | — | ✔ | — | — | | |
| Risk & Employer Profile | ✔ | ✔ | ✔ | △ | △ | △ | R | — | | |
| Reports | ✔ | ✔ | ✔ | △ (operational) | △ (finance) | △ (legal) | ✔ | — | | |
| Compliance Setup | ✔ | △ | — | — | — | — | — | — | | |
| Rule Engine / Rule Configuration | ✔ | ✔ **?** | ✔ **?** | ✔ **?** | — | — | — | — | **Decision ROLE-07** | |
| Templates | ✔ | △ | — | — | — | — | — | — | | |
| Automation | ✔ | △ | — | — | — | — | — | — | | |
| Geography (offices / zones) | ✔ | R | R | — | — | — | — | — | | |
| Staff / Queue Configuration | ✔ | ✔ | △ | — | — | — | — | — | | |

**Note on the Rule Engine row:** in the current build, Compliance Head, Senior Inspector and Compliance Inspector can all reach the Compliance rule configuration area. This is flagged for your decision — see Section 12.

---

## 12. Specific Access Decisions Arising From the Current Build

These observations come from the most recent persona certification and have been re-verified against the current build. They require a **business** decision; they are not defects.

### OB-1 — Rule Engine visibility (still present)

**Current behaviour:** Compliance Head, Senior Inspector and Compliance Inspector can all view the Compliance rule configuration area. Compliance Finance User, Compliance Legal Officer, Compliance Reports Viewer and Read Only cannot.

**Question:** Who should be permitted to **view** or **manage** Compliance rule configuration?

| Option | Select |
|---|:-:|
| Compliance Admin only | ☐ |
| Compliance Admin + Compliance Head | ☐ |
| Compliance Admin + selected authorised managers (please name the positions) | ☐ |
| Other: ______________________________________________ | ☐ |

Please also indicate whether **viewing** rules and **changing** rules should be separated: ☐ Yes ☐ No

### OB-2 — Landing page for Finance users

**Current behaviour:** the general Compliance dashboard directs users to the management workbench, which Finance users are not authorised to see. Finance users' working landing page is the work queue.

**Question:** Which screen should a Finance user see immediately after signing in? ______________________________________________

### OB-3 — Breadth of Compliance Head authority

**Current behaviour:** Compliance Head holds the widest operational authority in the module, including waivers, overrides, legal recommendation approval, arrangement approval and enterprise reporting.

**Question:** Should any of these be moved to a separate approver, or restricted to a second-level authority? ______________________________________________

### OB-4 — Message shown when access is denied

**Current behaviour:** where a Compliance user attempts to open user-administration screens, access is correctly prevented, but the message shown reads "Page not found" rather than "Access denied". Access is not affected.

**Question:** Do you require the wording to be aligned before go-live? ☐ Yes ☐ No

### OB-5 — Individual user exceptions

**Current behaviour:** the system permits an exception to be recorded against an individual user to grant or withhold a specific activity. Very few exceptions exist today.

**Question:** Should individual exceptions be permitted in production, and if so, who may authorise one? ______________________________________________

---

## 13. Data Access and Organisational Scope

Role and data scope are **separate**. Please indicate, for each category of user, what they should be able to see. Tick all that apply, and add comments where the answer depends on circumstances.

| Scope option | Inspectors | Senior Inspectors | Compliance Head | Finance | Legal | Reporting users |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| Entire Compliance population | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Only assigned employers | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Only their own inspections | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Their own work plus subordinate officers' work | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| A specific office | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| A specific zone | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| A specific work queue | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| A specific employer category (for example, large employers) | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| All Compliance records without restriction | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |

**Additional scope questions**

| # | Question | Customer answer |
|---|---|---|
| S-01 | Should an officer retain visibility of a case after it is reassigned to another officer? | |
| S-02 | Should a supervisor see all officers in their office, or only their direct reports? | |
| S-03 | Should Legal see the full Compliance history of an employer, or only the escalated matter? | |
| S-04 | Should Finance see non-financial Compliance records (findings, evidence, notices)? | |
| S-05 | Should scope change automatically when an officer transfers between zones or offices? | |

---

## 14. Reporting and Sensitive Information

Please state who may access each category of information.

| # | Information category | Who may **view**? | Who may **export** (Excel / CSV / PDF)? | Comments |
|---|---|---|---|---|
| R-01 | Employer financial data | | | |
| R-02 | Arrears | | | |
| R-03 | Payment arrangements | | | |
| R-04 | Breaches | | | |
| R-05 | Penalties | | | |
| R-06 | Risk scores | | | |
| R-07 | Inspector performance | | | |
| R-08 | Legal cases | | | |
| R-09 | Legal proceedings | | | |
| R-10 | Management analytics | | | |
| R-11 | Enterprise-wide Compliance reports | | | |

**Question R-12:** Should **viewing** a report and **exporting** it be treated as two separate privileges, so that some users may read on screen but not download?
☐ Yes, separate them ☐ No, treat as one ☐ Only for the categories marked above

---

## 15. Administration Responsibility

Please state who will administer each item, and confirm whether that responsibility sits with **Compliance business administration** or with **whole-application system administration**.

| # | Administration item | Responsible position | Compliance business administration | Whole-application system administration | Comments |
|---|---|---|:-:|:-:|---|
| AD-01 | Compliance users (creation, deactivation) | | ☐ | ☐ | |
| AD-02 | Role assignments for Compliance staff | | ☐ | ☐ | |
| AD-03 | Compliance setup and parameters | | ☐ | ☐ | |
| AD-04 | Rules | | ☐ | ☐ | |
| AD-05 | Templates | | ☐ | ☐ | |
| AD-06 | Geography | | ☐ | ☐ | |
| AD-07 | Zones | | ☐ | ☐ | |
| AD-08 | Office mappings | | ☐ | ☐ | |
| AD-09 | Work queues | | ☐ | ☐ | |
| AD-10 | Inspector assignments and caseload limits | | ☐ | ☐ | |
| AD-11 | Automation and scheduled processing | | ☐ | ☐ | |
| AD-12 | Reference numbering | | ☐ | ☐ | |
| AD-13 | Communications and notification templates | | ☐ | ☐ | |
| AD-14 | Risk policies and scoring models | | ☐ | ☐ | |

**Reminder:** creating and deactivating **login accounts** and assigning **roles** are normally IT/Security responsibilities under your security policy, even where the *request* originates from Compliance management. Please confirm the intended split.

---

## 16. Customer Decision Register

| ID | Decision required | Current system baseline | Customer decision | Owner | Status | Comments |
|---|---|---|---|---|---|---|
| ROLE-01 | Multiple-role assignment policy — will you permit users to hold more than one role, and who approves each combination? | Supported; multiple roles combine to the wider authority | | | Open | |
| ROLE-02 | Compliance Head authority — is the current breadth (waivers, overrides, approvals, enterprise view) correct? | Widest operational authority in the module | | | Open | |
| ROLE-03 | Senior Inspector approval authority — plans, reports, arrangements, partial payments, legal recommendations | All of the above are currently permitted | | | Open | |
| ROLE-04 | Finance responsibilities — exact activities Finance may perform | Narrow: allocation, instalments, breaches, arrears reporting | | | Open | |
| ROLE-05 | Legal responsibilities — extent of legal approval authority | Narrow: legal queue, review, proceedings; no general Compliance approval | | | Open | |
| ROLE-06 | Reporting access — which reports, and whether export is separated from viewing | Reports Viewer may view and export authorised reports | | | Open | |
| ROLE-07 | Rule Engine access — who may view and who may change Compliance rules | Compliance Admin, Compliance Head, Senior Inspector and Compliance Inspector can currently view | | | Open | |
| ROLE-08 | Configuration authority — templates, automation, geography, queues, numbering | Compliance Admin, with limited Head access | | | Open | |
| ROLE-09 | Office / zone / data scope for each category of user | Scope is configurable per user; production values not yet agreed | | | Open | |
| ROLE-10 | Maker–checker restrictions (Section 8, SoD-01 to SoD-12) | Workflow and approval separation supported; enforcement policy not yet set | | | Open | |
| ROLE-11 | User-specific exceptions — permitted in production, and who authorises them | Supported and auditable; very few in use | | | Open | |
| ROLE-12 | Global System Administrator vs Compliance Admin — who holds each | Both exist and are separate | | | Open | |
| ROLE-13 | Landing page for Finance users (OB-2) | Finance users land on the work queue | | | Open | |
| ROLE-14 | Wording of the access-denied message on administration screens (OB-4) | Access correctly prevented; wording differs | | | Open | |
| ROLE-15 | Read Only persona — is a restricted observer role required in production, and for whom? | Exists; denied all Compliance operational screens | | | Open | |

---

## 17. Recommended Role Design Principles

We recommend the following principles when completing this pack.

1. **Assign the minimum roles necessary** for the person's actual responsibilities.
2. **Do not create a role for every employee.** Roles describe functions, not individuals.
3. **Do not create separate roles merely because users work in different offices or zones** — data scope handles that distinction more simply and more reliably.
4. **Use additional roles only where the employee genuinely performs an additional function**, not "just in case".
5. **Keep Finance and Legal responsibilities narrowly scoped** to their specific activities.
6. **Keep global System Administration separate from Compliance Administration.**
7. **Respect maker–checker and segregation-of-duties controls** — the person who prepares should not normally be the person who approves.
8. **Avoid excessive user-specific exceptions.** If several people need the same exception, that is a signal the role design should change instead.
9. **Review role combinations periodically** — at least annually, and whenever a person changes position.
10. **Ensure role changes are auditable** — every assignment and change should be traceable to who made it and when.

---

## 18. Customer Sign-Off

| Item | Detail |
|---|---|
| **Customer Organisation** | |
| **Prepared / Reviewed By** | |
| **Compliance Representative** (name, position) | |
| **IT / Security Representative** (name, position) | |
| **Finance Representative** (optional) | |
| **Legal Representative** (optional) | |

**Approved Role Model:** ☐ Yes ☐ No ☐ Subject to the changes noted below

**Outstanding decisions (list decision IDs from Section 16):**

_______________________________________________________________

_______________________________________________________________

**Date:** ______________________

**Signature / Approval Reference:** ______________________________________________

---

## Appendix A — Terminology Reference (Optional, for IT/Security Readers)

This appendix is provided for your IT and security administrators only. It is not required in order to complete the questionnaires.

| Business term used in this document | How it is represented in the system |
|---|---|
| Role | A named role record; a user may hold several, and the authorised activities of all roles held are combined |
| Permission | A granted action (view, create, edit, approve, delete) against a registered functional area |
| User-specific exception | An individual grant or denial recorded against a single user for a single action, with a recorded reason |
| Operational role resolution | Compliance recognises three operational levels — Head, Senior and Inspector — derived from the roles the user holds; where a user holds more than one, the highest applies |
| Data scope | Derived from the officer record (office, primary zone, supervisor, caseload) and, where applicable, assigned queues and employer portfolios |
| Reporting hierarchy | Held on the staff profile (reporting line and designation) and on the Compliance officer record (supervisor) |
| Compliance Admin vs Global System Administrator | Two distinct roles; the former is limited to the Compliance domain, the latter is application-wide |

**End of document.**
