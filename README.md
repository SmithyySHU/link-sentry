# link-sentry

Automated broken link monitoring for websites.

link-sentry is a work-in-progress SaaS application that scans websites on a recurring basis to detect broken internal and external links. Results are stored and presented through a simple dashboard and email reports.

The focus of this project is to build a reliable, automated system rather than a full SEO analysis tool.

## Motivation

Broken links negatively affect user experience, SEO, and overall site quality. Despite this, many small website owners only discover issues after users report them.

This project aims to make broken link monitoring a background task that runs automatically, with minimal ongoing effort from the user.

## Current Status

## 🚧 Project status

Link-Sentry is in **early backend development**, but there’s already real code running.

What’s implemented so far:

- Monorepo layout with npm workspaces (`packages/crawler`, `packages/db`)
- Crawler service that:
  - fetches a page
  - extracts links
  - normalises URLs
  - validates links with timeouts and a custom User-Agent
  - classifies links as `ok`, `broken`, or `blocked`
- PostgreSQL schema and data layer:
  - `sites`, `scan_runs`, `scan_results`
  - shared connection helper using `DATABASE_URL`
- CLI workflows for local development:
  - Run a single scan and persist results:
    ```bash
    npm run scan:once -- <siteId> <startUrl>
    ```
  - Inspect the latest scan:
    ```bash
    npm run demo:latest-scan
    ```
  - View history of scans for a site:
    ```bash
    npm run demo:site-history -- <siteId>
    ```

This is still developer-focused tooling; there’s no public UI yet. Next steps are a small API layer and a basic dashboard to surface these scan results.


## Tech Stack (Planned)

- Frontend: Next.js / React
- Backend: Node.js
- Database: PostgreSQL
- Background jobs: Node.js worker
- Payments: Stripe

## Notes

This repository is under active development. Details may change as the project evolves.
