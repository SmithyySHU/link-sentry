# Security Policy

This document describes the current security posture of **Scanlark**.

> **Status:** This project is currently in active development and **not yet hardened for public, multi-tenant production use**.  
> The notes below explain known limitations and how we plan to address them.

---

## Supported Versions

At the moment there is no formally “supported” production version.

- `main` and active feature branches (for example `feature/api-layer`) are considered **development branches**.
- Security issues may be addressed on a best-effort basis while the product is still evolving.

Before any production release we plan to:

- Define a supported release line.
- Tag versions that have passed security hardening checks.

---

## Architecture Overview (relevant to security)

High-level components:

- **Crawler service** (`packages/crawler`):  
  Crawls user-supplied URLs and records link status.
- **API layer** (`apps/api`):  
  Exposes endpoints for starting scans and reading scan results.
- **Web UI** (`apps/web`):  
  Internal dashboard for viewing scan history and broken links.
- **Database layer** (`packages/db`):  
  Persistence for sites, scan runs and scan results.

The crawler **intentionally makes outbound HTTP(S) requests** to user-supplied URLs in order to check links.  
Most of the interesting security considerations are around **SSRF and URL handling**.

---

## URL Handling and SSRF Mitigations

The crawler entry point for fetching HTML is `packages/crawler/src/fetchUrl.ts`.

### What we do today

When a URL is passed into the crawler:

1. **URL parsing and protocol allow-list**
   - The URL is parsed with `new URL(rawUrl)`.
   - Only `http:` and `https:` protocols are allowed.
   - Any other protocol (for example `file:`, `ftp:`, `gopher:`, etc.) is rejected.

2. **Hostname resolution and IP allow-list**
   - The hostname is resolved via DNS (`dns/promises.lookup`).
   - Every resolved address is checked:
     - Private IPv4 ranges (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)
     - Link-local ranges (169.254.0.0/16, `fe80::/10`)
     - Loopback (127.0.0.0/8, `::1`)
   - If any resolved address is private or loopback, the crawl is rejected with an error.

3. **Redirect handling**
   - Fetch is performed with `redirect: "manual"`.
   - Up to a fixed number of redirects are followed.
   - Each redirect target is:
     - Resolved relative to the previous URL.
     - Re-validated using the exact same rules as the original URL
       (protocol check + DNS + private/loopback address blocking).
   - If the redirect chain is too long, the crawl is aborted.

4. **Timeout and content-type checks**
   - Requests are bounded by a timeout (`HTML_FETCH_TIMEOUT_MS`) using `AbortController`.
   - Only responses with `content-type` including `text/html` are processed.  
     Others are ignored for link crawling purposes.

### CodeQL “Server-side request forgery” alert

CodeQL flags the fetch call in `fetchUrl.ts` as a potential **Server-Side Request Forgery (SSRF)** issue because the URL originates from user input.

In our case:

- SSRF-like behaviour is **part of the core feature** (we have to fetch user-supplied URLs to check links).
- We mitigate risk by:
  - Restricting to `http` / `https` only.
  - Resolving DNS and blocking private/loopback address ranges.
  - Re-validating every redirect hop.
  - Applying per-request timeouts and content-type filtering.

Despite those mitigations, the CodeQL rule is not aware of our validation logic and still reports the sink.

> **Decision:**  
> We currently mark this finding as **“known / accepted risk” while the project is in development**.  
> Before any production, internet-facing deployment we will:
>
> - Re-review SSRF controls against our final architecture (network boundaries, deployment topology).
> - Consider additional hardening (explicit allow-lists, per-tenant rules, regional routing, etc.).
> - Re-tune or suppress the CodeQL rule with a clear justification if it remains a false-positive for our use case.

---

## Build-tool Vulnerability: esbuild Dev Server CORS

Dependabot reports a vulnerability in **`esbuild` ≤ 0.24.2** related to its built-in dev server:

- The dev server sets `Access-Control-Allow-Origin: *` on all responses.
- This can, in some scenarios, let a malicious website read resources from a local `esbuild` dev server running on the developer’s machine.

### How Scanlark uses esbuild

- `esbuild` is used **only as a build tool / bundler**, pulled in via:
  - `vite`
  - `@vitejs/plugin-react`
  - `@vitejs/plugin-react-swc`
  - `tsx`
- **We do not use `esbuild`’s own `serve()` API** in production.
- For development, we run the **Vite dev server**, not the esbuild dev server directly.

### Why Dependabot can’t auto-fix this

`esbuild` is pulled in with different version constraints:

- Some dependencies require `esbuild` around `0.21.x` (for example via Vite 5.x).
- Others work with `0.27.x`.
- The earliest fixed version is `0.25.0`.

Because these ranges conflict, Dependabot cannot bump `esbuild` to a fixed version without breaking the current toolchain.

### Current stance

For now:

- This issue affects **local development environments only**, not production deployments of Scanlark.
- We treat it as a **known limitation of the current dev toolchain**.

> **Decision:**
>
> - We accept this risk for ongoing development.
> - We will revisit the toolchain (Vite / esbuild / tsx versions) before a production release and upgrade to a version where `esbuild` is patched.
> - Developers should avoid exposing local dev servers to untrusted networks and should only run them on their own machines.

---

## Other Known Limitations

These are broader “not fully hardened yet” items:

- **Authentication & authorization**
  - The current API and web UI are intended for internal development use.
  - There is currently no complete auth layer for multi-tenant, internet-facing deployments.
  - A proper auth story (session or token-based) is required before public release.

- **Rate limiting & abuse protection**
  - Requests to start scans are not yet rate-limited.
  - Public deployment will require:
    - Per-user or per-IP rate limiting.
    - Possibly quotas per account.
    - Monitoring and alerting for abuse patterns.

- **Input validation beyond URLs**
  - URL validation is relatively strict.
  - Other inputs (for example metadata that may be added later) will need additional validation and sanitisation.

- **Security headers & hardening**
  - Production builds will require:
    - Appropriate HTTP security headers (CSP, X-Frame-Options, etc.).
    - Hardened reverse-proxy configuration.
    - TLS enforcement.

These are tracked as part of the “production-hardening” checklist and will be addressed before any public SaaS-style deployment.

---

## Reporting a Vulnerability

If you believe you’ve found a security issue in Scanlark:

- Please open a **private security report** (for example via GitHub Security Advisory / private issue) rather than a public issue with exploit details.
- Provide:
  - A clear description of the issue and potential impact.
  - Steps to reproduce.
  - Any relevant logs or payloads (with secrets removed).

We will review reports on a best-effort basis while the project is under active development.
