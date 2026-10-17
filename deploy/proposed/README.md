# Proposed (not active) browser-security configuration

Nothing in this folder is used by the running site. These are staged, reviewable
changes with their dependencies, risks and rollback. What *is* active in
`nginx.conf` on this branch: real `/robots.txt`, `/sitemap.xml` and 404
responses, `Cache-Control` for pages/CSS/fonts, and `X-Robots-Tag: noindex` for
the terms draft, admin and demo pages. The enforced CSP and all other existing
headers are unchanged.

## 1. Tighter Content-Security-Policy — enforcement deferred

**Why not now.** The enforced policy allows `script-src 'unsafe-inline'`. The
results page, dialogs and question panel no longer use inline event handlers
(this branch moved them to `addEventListener`). Three things still depend on
inline script, and all three are outside what this branch may change:

| Dependency | Where | Why it blocks removal |
|---|---|---|
| Inline handlers in the submission form | `#page-submit` markup and `addCollege()` / `showSuggestions()` / `showMajorSuggestions()` in `html/index.html` (16 handlers) | Some are generated per row (`showSuggestions('cn-3')`), so they can't be allow-listed by hash. Changing them means editing the protected form. |
| The page's main `<script>` is inline | `html/index.html` | Needs a hash or nonce, or moving to `/app.js`. The script contains the protected submission functions, so moving it is a deploy-level change to review with the form work. |
| Admin page inline handlers | `html/admin.html` (13 handlers) | Admin access is out of scope for this branch. |

**Stage 1: report-only, safe to deploy any time.** Add next to the existing
`add_header Content-Security-Policy` line in `nginx.conf`:

```nginx
add_header Content-Security-Policy-Report-Only "default-src 'self'; script-src 'self'; script-src-attr 'none'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'; manifest-src 'none'; worker-src 'none'" always;
```

It blocks nothing. Browsers log what *would* be blocked to the developer
console (there is deliberately no `report-uri`, so no new data collection or
endpoint). Expect violations only from the three dependencies above. Checked
locally: the results view, dialogs and question panel produce none apart from
the inline `<script>` block itself.

- Risk: none functional; console noise for anyone with dev tools open.
- Rollback: delete the line and reload nginx.

**Stage 2: enforce, after the form and admin page are refactored.**
1. Move the inline `<script>` to `/app.js` (and admin's to `/admin.js`).
2. Replace remaining inline handlers with listeners.
3. Swap the enforced header's `script-src 'self' 'unsafe-inline'` for
   `script-src 'self'; script-src-attr 'none'`.
4. Re-run `tests/browser` (submission compatibility tests included) in staging,
   then promote.

- Rollback: restore the previous header line.

## 2. HSTS — document readiness; set it at the TLS terminator, not here

This container's nginx listens on plain HTTP port 80 behind a reverse proxy on
the `webinfra_frontend` network. TLS and the HTTP→HTTPS redirect happen in
that proxy, which is not in this repository. The 2026-10-16 audit observed a
308 redirect from HTTP to HTTPS for `admissions.francke.com` and no
`Strict-Transport-Security` header.

Before enabling:
- [ ] Confirm every hostname that serves this site redirects to HTTPS with a
      valid certificate, and that certificate renewal is automated and monitored.
- [ ] Confirm who controls `francke.com` DNS and the proxy.

Then, at the TLS-terminating proxy for this hostname only:

```
Strict-Transport-Security: max-age=300
```

Raise it to `max-age=86400`, then `max-age=31536000`, once a week or so passes
without problems at each step.

- Do **not** add `includeSubDomains`. `francke.com` has other users (at least
  email), and there is no evidence every subdomain is HTTPS-only.
- Do **not** submit to the preload list. Preload is hard to undo and needs
  `includeSubDomains`.
- Rollback: send `max-age=0` for at least the previous `max-age` period.
  Browsers keep the old policy until it expires, which is why it starts at 5 minutes.

## 3. API response caching — proposal only

`/api/*` responses currently carry no `Cache-Control` (Express adds an ETag).
This branch deliberately leaves the API untouched. Proposal for review:

- `GET /api/submissions` (public feed): `Cache-Control: no-cache`, so every view
  revalidates and a deletion disappears on the next load.
- `GET /api/submissions/:id`, all `/api/admin/*`: `Cache-Control: no-store`.

Add this in `api/server.js` (or as a `location` header in nginx with the
security headers repeated). Test with the browser suite. Rollback: remove the headers.
