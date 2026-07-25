# `/projaudit` Staging Deployment Evidence

- Verified: 2026-07-25
- Public staging alias: https://journalnode-projaudit.vercel.app
- Authenticated health check: https://journalnode-projaudit.vercel.app/health?verify=auth
- Immutable deployment: https://journalnode-projaudit-ewmf0evc3-wizbubbas-projects.vercel.app
- Vercel deployment ID: `dpl_2NBoWs2w5AKdkC93pdRXtYzNkten`
- Runtime: Vercel Functions on Node.js 24
- Architecture memo: https://gist.github.com/journalnode/232841d089bb013d183ef126f810b8ea

## Verification

`npm test` passes all six scaffold tests with zero failures and zero dependency vulnerabilities.

The public authenticated health endpoint returns HTTP 200 and reports:

- `status: ok`
- `openrouter.configured: true`
- `openrouter.authenticated: true`
- `github.configured: true`
- `github.authenticated: true`
- `auditLogic: not-implemented`

`POST /projaudit` returns HTTP 200 with `stage: scaffold-ping` and `auditExecuted: false`, confirming the deployment pipeline without implementing audit logic.

The browser capture is stored at `evidence/staging-health.png`.
