# Dev Notes

Short guide for local development and common API calls.

## Prereqs

- Node 18+
- PostgreSQL with a `DATABASE_URL` env var set

## Install

```bash
npm install
```

## Run services

```bash
# API (http://localhost:3001)
npm run dev:api

# Web app (Vite dev server)
npm run dev:web
```

Optional helpers:

```bash
# DB connection smoke test
npm run dev:db

# One-off crawler run (persist results)
npm run scan:once -- <siteId> <startUrl>
```

Note: `npm --workspaces run build` may print a Vite CJS deprecation warning; the build still completes successfully.

## Migrations

The DB package ships SQL migrations in `packages/db/migrations/`.
Apply them in order with your preferred PostgreSQL tool, for example:

```bash
psql "$DATABASE_URL" -f packages/db/migrations/001_init.sql
psql "$DATABASE_URL" -f packages/db/migrations/002_add_scan_links.sql
# ...
```

## Key endpoints

Base URL: `http://localhost:3001`

- Start scan: `POST /sites/:siteId/scans` body `{ "startUrl": "https://example.com" }`
- Scan progress: `GET /scan-runs/:scanRunId` or SSE `GET /scan-runs/:scanRunId/events`
- Links list (deduped): `GET /scan-runs/:scanRunId/links?classification=broken&limit=50&offset=0`
- Links summary: `GET /scan-runs/:scanRunId/links/summary`
- Occurrences for link: `GET /scan-links/:scanLinkId/occurrences?limit=50&offset=0`
- Occurrences by URL: `GET /scan-runs/:scanRunId/links/:encodedLinkUrl/occurrences`
- Ignore rules (site): `GET /sites/:siteId/ignore-rules`
- Ignore rules (global): `GET /ignore-rules`
