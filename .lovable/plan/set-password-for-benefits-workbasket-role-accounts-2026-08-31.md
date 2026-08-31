# Set password for Benefits workbasket role accounts

Set the password to `Benefits@123$` for the 10 Benefits/rule test accounts used to log in and check workflow workbaskets.

## Accounts
- benefits.admin@mishainfotech.com (BN_CONFIG_ADMIN, BN_AUDITOR)
- benefits.director@mishainfotech.com (BN_DIRECTOR, BN_PRODUCT_APPROVER)
- benefits.manager@mishainfotech.com (BN_MANAGER, BN_AWARD_OFFICER, BN_PRODUCT_MANAGER)
- benefits.officer@mishainfotech.com (BN_INTAKE_OFFICER, BN_CLAIMS_OFFICER, BN_ELIGIBILITY_OFFICER, BN_CALCULATION_OFFICER, BN_DOCUMENT_OFFICER)
- benefits.payment@mishainfotech.com (BN_PAYMENT_OFFICER)
- benefits.supervisor@mishainfotech.com (BN_SUPERVISOR, BN_SENIOR_ELIGIBILITY_OFFICER, BN_CLAIMS_OFFICER)
- finance.supervisor@mishainfotech.com (BN_FINANCE_SUPERVISOR)
- rule.author@mishainfotech.com (BN_RULE_AUTHOR)
- rule.legal@mishainfotech.com (BN_RULE_LEGAL_APPROVER)
- rule.technical@mishainfotech.com (BN_RULE_TECHNICAL_REVIEWER)

## Steps
1. Update the stored credential for each account to the new password (hashed with bcrypt), and confirm each email is confirmed so sign-in is not blocked.
2. Clear any login lockout state on the matching profile records (failed attempts, lock expiry, forced password change).
3. Verify by signing in with each of the 10 accounts against the auth endpoint and report a pass/fail table.
4. After completion, report the final login credentials list.

## Login details after completion
The login ID is the email address itself; the password for all 10 is `Benefits@123$`.

| Login ID | Use for workbasket |
| --- | --- |
| benefits.officer@mishainfotech.com | Intake Review, Eligibility, Calculation, Documents |
| benefits.supervisor@mishainfotech.com | Supervisor Approval, Senior Eligibility |
| benefits.manager@mishainfotech.com | Manager Approval, Award Setup |
| benefits.director@mishainfotech.com | Director / Product Approval |
| benefits.payment@mishainfotech.com | Payment Processing |
| finance.supervisor@mishainfotech.com | Finance Approval |
| benefits.admin@mishainfotech.com | Config Admin / all-basket oversight |
| rule.author@mishainfotech.com | Rule authoring |
| rule.technical@mishainfotech.com | Rule technical review |
| rule.legal@mishainfotech.com | Rule legal approval |


## Technical notes
- Password hash written via `crypt(..., gen_salt('bf'))` on `auth.users.encrypted_password`; `email_confirmed_at` backfilled where null.
- Profile reset touches `failed_login_attempts`, `locked_until`, `force_password_change` only if those columns exist.
- No application code changes; data-only operation.
