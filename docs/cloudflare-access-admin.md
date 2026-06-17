# Protect `/admin/` And `/admin-v2/` With Cloudflare Access

The Station Cat admin pages are static Astro pages backed by Worker admin APIs. Real email verification must be enforced by Cloudflare Access at the edge, not by JavaScript in the browser.

The Worker also fails closed for `/admin*` and `/admin-v2*` when Cloudflare Access environment variables are missing or the Access JWT is invalid. Local `localhost` development is allowed through so the admin UI can still be tested with Wrangler.

Use this setup after the site is deployed to Cloudflare Pages.

## Goal

Only allow this email to open `/admin/` and `/admin-v2/`:

```text
brodstem@protonmail.com
```

Everyone else should be blocked before the admin page loads.

This repository includes both a Worker-level guard in `src/worker.js` and `functions/_middleware.js` for Pages-style deployments. Both verify the Cloudflare Access JWT for `/admin*` and `/admin-v2*` and fail closed if Access is not configured.

## Cloudflare Zero Trust Setup

1. Open Cloudflare Dashboard.
2. Go to `Zero Trust`.
3. Go to `Settings` or `Integrations` > `Identity providers`.
4. Add or confirm `One-time PIN` is enabled.
5. Go to `Access controls` > `Applications`.
6. Select `Create new application`.
7. Choose `Self-hosted`.
8. Add the public hostname for your deployed website.
9. Protect the admin routes:

```text
Domain: your production domain
Path: /admin*
```

Add a second route for Admin 2.0:

```text
Domain: your production domain
Path: /admin-v2*
```

These routes must cover both admin pages and admin API routes, including:

```text
/admin/api/content/schema
/admin/api/content/entries
/admin/api/content/body
/admin/api/content/revisions
/admin/api/content/audit-logs
/admin/api/novels/entitlements
/admin/api/novels/payments/orders
/admin-v2/
```

If Cloudflare does not match wildcard paths as expected, create explicit Access applications or rules:

```text
/admin
/admin/*
/admin-v2
/admin-v2/*
```

10. Create an `Allow` policy:

```text
Rule type: Include
Selector: Emails
Value: brodstem@protonmail.com
```

11. Enable `One-time PIN` as the login method.
12. Save the application.

## Cloudflare Pages Environment Variables

Add these variables in your Cloudflare Pages project:

```text
ADMIN_ALLOWED_EMAILS=brodstem@protonmail.com
CF_ACCESS_TEAM_DOMAIN=your-team.cloudflareaccess.com
CF_ACCESS_AUD=your-access-application-audience-tag
```

Where to find them:

- `CF_ACCESS_TEAM_DOMAIN`: your Zero Trust team domain, usually visible in the Access app and shaped like `your-team.cloudflareaccess.com`.
- `CF_ACCESS_AUD`: the `Application Audience (AUD) Tag` from the Access application page.

The Worker guard and middleware use these values to verify that the request really came through Cloudflare Access and that the signed-in email is allowed.

## Test

1. Open a private/incognito browser window.
2. Visit `/admin/` and `/admin-v2/`.
3. Cloudflare Access should show an email login screen before the website loads.
4. Enter `brodstem@protonmail.com`.
5. Paste the code sent to that mailbox.
6. Confirm the admin page loads.
7. Try a different email. It should not receive access.

## Repository-Side Safeguards

This repo also includes:

- No public navigation link to `/admin/`.
- `public/_headers` rules to mark `/admin` and `/admin/*` as `noindex` and `no-store`.
- Worker-level admin guard in `src/worker.js` for `/admin*` and `/admin-v2*`.
- `functions/_middleware.js` to verify Cloudflare Access JWTs for `/admin/` and `/admin-v2/` on Cloudflare Pages-style deployments.
- Stage 7A backend content APIs under `/admin/api/content/*` are intentionally nested below `/admin` so the same Access rule covers Admin 2.0 content operations.

The headers and hidden links are not a replacement for Cloudflare Access. The Worker guard and middleware are defense-in-depth checks and require the Access application plus the environment variables above.

## References

- Cloudflare Access applications: https://developers.cloudflare.com/learning-paths/clientless-access/access-application/create-access-app/
- Cloudflare Access application paths: https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/
- Cloudflare One-time PIN: https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/
