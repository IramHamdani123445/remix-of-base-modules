# Sign in as the Eligibility Officer

Goal: be able to log into the app as the user holding `BN_ELIGIBILITY_OFFICER` and confirm the Claim Queue shows that role's basket.

Account: **benefits.officer@mishainfotech.com** — the only user carrying `BN_ELIGIBILITY_OFFICER`. Its current password is not recoverable (only a hash is stored), so it has to be set.

## Setting the password to Admin@123

Passwords live in the managed auth store, which cannot be written from app code or a migration. Two ways to set it:

1. **You set it (fastest, no code):** Cloud → Users → find `benefits.officer@mishainfotech.com` → set password to `Admin@123`.
2. **I set it:** I add a one-off admin-side script that calls the auth admin API to update that single user's password, run it once, and remove it. This needs the service role, which is not available to me on this project — so this path only works if option 1 is not acceptable and you supply another route.

Realistically: option 1.

## After the password is set

I sign the preview in as that officer and verify, with screenshots:

- Claim Queue lists **Eligibility Review** as the officer's basket (and nothing they do not serve)
- the 1 routed claim in that basket appears for them
- the "My baskets / All baskets" toggle is hidden for this non-oversight role

## Note on credentials

`Admin@123` is a weak, shared password on an account that can act on live claims. Fine for TEST; it should not survive into production, and I will flag it in the certification notes rather than leave it undocumented.
