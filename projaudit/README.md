# Journal Node `/projaudit` Backend Scaffold

This directory contains the Day 35b serverless foundation for `/projaudit`. It intentionally stops before audit logic and proves the deployment and external-integration boundaries needed for the full implementation.

## Architecture

The Day 35a architecture memo selects a self-hosted web/API deployment and leaves the serverless provider choice to scaffolding. This project uses Vercel Functions because the existing `/audit` pipeline is Node/CommonJS code and can be ported without an edge-runtime rewrite.

- `api/health.js` exposes deployment and integration status.
- `api/projaudit.js` exposes a placeholder `/projaudit` contract without audit behavior.
- `src/openrouter.js` ports the existing `/audit` OpenRouter wrapper and `callModel` contract.
- `src/github.js` ports GitHub authentication and public gist creation.
- `src/config.js` reads secrets only from runtime environment variables.

## Environment

Copy `.env.example` to `.env.local` for local development. Configure the same names as Vercel project secrets for Preview and Production environments:

- `OPENROUTER_API_KEY`
- `GITHUB_GIST_TOKEN` or `GITHUB_TOKEN`
- `OPENROUTER_MODEL` (optional)

The health response reports only whether each secret is configured. It never returns secret values.

## Routes

- `GET /health` — deployment and configuration status.
- `GET /health?verify=auth` — non-destructive authentication checks against OpenRouter and GitHub.
- `GET /projaudit` — scaffold capabilities.
- `POST /projaudit` — placeholder pipeline ping; no audit logic or provider call occurs.

## Local Verification

```sh
npm install
npm test
npm run dev
```

## Deployment

```sh
npx vercel deploy
```

After configuring Preview secrets, use the returned staging URL and verify `/health?verify=auth` returns HTTP 200 with both providers marked `authenticated: true`.
