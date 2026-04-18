# DesignMate

DesignMate is the BIMWERX and GenFEA deployment fork of Big-AGI, tailored for structural engineering workflows and desktop integration.

This fork stays intentionally close to upstream:

- Keep the Big-AGI core as intact as practical.
- Isolate DesignMate-specific behavior under `src/modules/designmate`.
- Disable product areas that are not part of the DesignMate offering.
- Preserve a clean path for selectively adopting future upstream updates.

## Fork Goals

- Rebrand the runtime experience as `DesignMate`.
- Simplify first-run onboarding so setup focuses on provider and API-key configuration.
- Disable `Call`, `Beam`, `speech`, `news`, and social-link surfaces for the DesignMate deployment.
- Add a DesignMate REST API for GenFEA desktop integration.
- Support server-backed threads so API-created conversations can appear inside the web UI.

## DesignMate API

Current endpoints:

- `POST /api/designmate/chat`
- `GET /api/designmate/threads`
- `GET /api/designmate/threads/[threadId]`
- `GET /api/designmate/assets/[assetId]`
- `POST /api/designmate/ui/chat`
- `GET /api/designmate/ui/threads`

Authenticated endpoints use the `x-designmate-app-token` header and require `DESIGNMATE_APP_TOKEN`.

## Environment Variables

- `DESIGNMATE_APP_TOKEN`
- `DESIGNMATE_API_VENDOR`
- `DESIGNMATE_API_MODEL`
- `DESIGNMATE_API_REASONING`
- `POSTGRES_PRISMA_URL`
- `POSTGRES_URL_NON_POOLING`

Without Postgres configured, server-backed DesignMate threads remain unavailable by design.

## Development

```bash
npm install
npm run dev
```

Verification:

```bash
npx tsc --noEmit --pretty
npm run build
```

## Upstream Merge Strategy

- Keep DesignMate-owned code in `src/modules/designmate`.
- Prefer feature flags and thin adapters over deep rewrites where possible.
- Maintain the upstream remote so future Big-AGI changes can be reviewed and merged selectively.
