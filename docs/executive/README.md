# Executive materials

Executive-level review materials for the storage host platform. These documents
summarize the architecture, what talks to what, project status, and the decisions
required to move from a complete build to a production-ready service.

The audience is executive and cross-functional. The technical source of truth
remains `docs/ARCHITECTURE.md`, `docs/COMPONENTS.md`, and the component documents.

## Artifacts

| Artifact | Purpose |
|---|---|
| `diagrams/01-high-level.d2` | High-level context: clients, controller, host, certificates, backup |
| `diagrams/02-mid-level.d2` | Mid-level sequence: trust boundary, ports, protocols, lifecycle triggers |
| `deck/build-deck.mjs` | Generates the 10-slide deck with PptxGenJS |
| `deck/package.json` / `package-lock.json` | Pins PptxGenJS 4.0.1 |
| `exports/` | Generated PNG, SVG, PPTX, and PDF; intentionally gitignored |

The rendered deck is:

```text
exports/Storage-Host-Executive-Update-2026-11-22.pptx
exports/Storage-Host-Executive-Update-2026-11-22.pdf
```

## Regenerate

Prerequisites:

- D2 **0.9.0**
- Node.js and npm
- LibreOffice for the PDF companion (optional)

D2 is not vendored in this repository. Install it from the pinned upstream
release, then run:

```bash
D2_BIN=/path/to/d2 ./build.sh
```

If D2 is on `PATH`:

```bash
./build.sh
```

The script refuses a different D2 version, installs the pinned Node dependency
with `npm ci` when needed, renders both diagrams, builds the PPTX, and converts
it to PDF when LibreOffice is available.

## Diagram notes

### High level

A four-actor view:

- Private clients
- Controller / CI
- `storage01`
- External dependencies

Numbered flows cover deploy, certificate lifecycle, requests, snapshots, and
the planned off-host backup. Timing is shown on the edges and repeated in the
deck's "WHEN" legend.

### Mid level

A sequence view across the trust boundary:

- Firewall and NGINX ingress
- Elasticsearch HTTPS and Garage HTTP loopback upstreams
- PostgreSQL and MariaDB direct TLS paths
- Certbot DNS-01 and deploy-hook reload
- Elasticsearch snapshots to Garage
- Planned off-host backup

The diagram is intentionally denser than the high-level view. The deck uses it
as the technical reference slide; the full-resolution export is suitable for
review in an image viewer.

## Deck outline

1. Title
2. Executive summary and decision requested
3. Architecture at a glance
4. High-level "what talks to what"
5. Mid-level ports and trust boundaries
6. What is done
7. What remains: four production gates
8. Risks and considerations
9. Decisions and 30/60/90-day path
10. Appendix: validation ledger

## Status statement

The deck is written as of **22 November 2026**:

- Build: complete
- Validation: partial
- Production: gated

The implementation baseline is commit `39d1f47`. The deck intentionally states
that Docker/Molecule, GitHub Actions, real-host certificate/SELinux/firewalld
checks, off-host restore, and monitoring are pending. Do not rewrite the status
to "production ready" until those gates are closed with evidence.

## Security and hygiene

- No secrets, age keys, or real private CIDRs belong in these materials.
- Use placeholders such as `<prod-domain>` and `<private-cidr>` in future edits.
- Generated exports are not committed, consistent with `AGENTS.md`.
- Keep PptxGenJS pinned; do not use a floating `^` range.
