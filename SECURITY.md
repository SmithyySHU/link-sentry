# Security Policy# Security Policy

## Supported versions

This project is currently under active development and does **not** yet promise
a stable security support policy. Security fixes are applied on a best-effort basis.

## Reporting a vulnerability

If you find a security issue, please **do not** open a public GitHub issue.

Instead, contact the maintainer directly:

GitHub Security Advisory (privately) if available on this repo.

We aim to acknowledge new reports within a reasonable timeframe and keep you
updated on progress.

## Crawler and SSRF protections

This project includes a web crawler that fetches HTML content from user-provided URLs.

To reduce the risk of Server-Side Request Forgery (SSRF) and similar issues, we:

- Restrict crawl targets to the `http` and `https` protocols.
- Reject URLs with `localhost`, `127.0.0.1`, or `::1`.
- Resolve hostnames and block requests to:
  - Private IPv4 ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`)
  - Link-local addresses (`169.254.0.0/16`, `fe80::/10`)
  - Loopback ranges (`127.0.0.0/8`, `::1`)
- Limit the number of HTTP redirects and re-validate each redirect target.
- Only process HTML cont# Security Policy

## Supported versions

This project is currently under active development and does **not** yet promise
a stable security support policy. Security fixes are applied on a best-effort basis.

## Reporting a vulnerability

If you find a security issue, please **do not** open a public GitHub issue.

Instead, contact the maintainer directly:

GitHub Security Advisory (privately) if available on this repo.

We aim to acknowledge new reports within a reasonable timeframe and keep you
updated on progress.

## Crawler and SSRF protections

This project includes a web crawler that fetches HTML content from user-provided URLs.

To reduce the risk of Server-Side Request Forgery (SSRF) and similar issues, we:

- Restrict crawl targets to the `http` and `https` protocols.
- Reject URLs with `localhost`, `127.0.0.1`, or `::1`.
- Resolve hostnames and block requests to:
  - Private IPv4 ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`)
  - Link-local addresses (`169.254.0.0/16`, `fe80::/10`)
  - Loopback ranges (`127.0.0.0/8`, `::1`)
- Limit the number of HTTP redirects and re-validate each redirect target.
- Only process HTML content and discard non-HTML responses.

These mitigations are **not a guarantee of complete protection**, but they are
designed to reduce risk and make abuse more difficult.

If you identify bypasses or weaknesses in these protections, please report them
using the process above.
ent and discard non-HTML responses.

These mitigations are **not a guarantee of complete protection**, but they are
designed to reduce risk and make abuse more difficult.

If you identify bypasses or weaknesses in these protections, please report them
using the process above.


## Supported versions

This project is currently under active development and does **not** yet promise
a stable security support policy. Security fixes are applied on a best-effort basis.

## Reporting a vulnerability

If you find a security issue, please **do not** open a public GitHub issue.

Instead, contact the maintainer directly:

GitHub Security Advisory (privately) if available on this repo.

We aim to acknowledge new reports within a reasonable timeframe and keep you
updated on progress.

## Crawler and SSRF protections

This project includes a web crawler that fetches HTML content from user-provided URLs.

To reduce the risk of Server-Side Request Forgery (SSRF) and similar issues, we:

- Restrict crawl targets to the `http` and `https` protocols.
- Reject URLs with `localhost`, `127.0.0.1`, or `::1`.
- Resolve hostnames and block requests to:
  - Private IPv4 ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`)
  - Link-local addresses (`169.254.0.0/16`, `fe80::/10`)
  - Loopback ranges (`127.0.0.0/8`, `::1`)
- Limit the number of HTTP redirects and re-validate each redirect target.
- Only process HTML content and discard non-HTML responses.

These mitigations are **not a guarantee of complete protection**, but they are
designed to reduce risk and make abuse more difficult.

If you identify bypasses or weaknesses in these protections, please report them
using the process above.
