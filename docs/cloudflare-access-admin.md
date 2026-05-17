# Protect `/admin/` With Cloudflare Access

The Station Cat admin page is a static Astro page. Real email verification must be enforced by Cloudflare Access at the edge, not by JavaScript in the browser.

Use this setup after the site is deployed to Cloudflare Pages.

## Goal

Only allow this email to open `/admin/`:

```text
brodstem@protonmail.com
```

Everyone else should be blocked before the admin page loads.

This repository also includes `functions/_middleware.js`. On Cloudflare Pages it verifies the Cloudflare Access JWT for `/admin/` and fails closed if Access is not configured.

## Cloudflare Zero Trust Setup

1. Open Cloudflare Dashboard.
2. Go to `Zero Trust`.
3. Go to `Settings` or `Integrations` > `Identity providers`.
4. Add or confirm `One-time PIN` is enabled.
5. Go to `Access controls` > `Applications`.
6. Select `Create new application`.
7. Choose `Self-hosted`.
8. Add the public hostname for your deployed website.
9. Protect the admin route:

```text
Domain: your production domain
Path: /admin*
```

If Cloudflare does not match `/admin*` as expected, create two Access applications or rules:

```text
/admin
/admin/*
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

The middleware uses these values to verify that the request really came through Cloudflare Access and that the signed-in email is allowed.

## Test

1. Open a private/incognito browser window.
2. Visit `/admin/`.
3. Cloudflare Access should show an email login screen before the website loads.
4. Enter `brodstem@protonmail.com`.
5. Paste the code sent to that mailbox.
6. Confirm the admin page loads.
7. Try a different email. It should not receive access.

## Repository-Side Safeguards

This repo also includes:

- No public navigation link to `/admin/`.
- `public/_headers` rules to mark `/admin` and `/admin/*` as `noindex` and `no-store`.
- `functions/_middleware.js` to verify Cloudflare Access JWTs for `/admin/` on Cloudflare Pages.

The headers and hidden links are not a replacement for Cloudflare Access. The middleware is a defense-in-depth check and requires the Access application plus the environment variables above.

## References

- Cloudflare Access applications: https://developers.cloudflare.com/learning-paths/clientless-access/access-application/create-access-app/
- Cloudflare Access application paths: https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/
- Cloudflare One-time PIN: https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/
