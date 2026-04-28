# Clubalmanac v2

Convex backend voor Clubalmanac. Vervangt de AWS-stack (DynamoDB + Lambda + S3 + Cognito) van de v1 repos.

Zie [`docs/migratie-plan-convex.md`](docs/migratie-plan-convex.md) voor de plan en fasering.

## Stack
- **Backend:** Convex (EU/Dublin, Starter plan)
- **Auth:** Clerk
- **Tests:** Vitest + `convex-test`
- **Taal:** TypeScript

## Setup
```bash
npm install
npx convex dev   # eerste keer: linkt aan Convex deployment
```

## Scripts
- `npm run typecheck` — `tsc --noEmit`
- `npm test` — Vitest run
- `npm run convex:dev` — Convex dev server + codegen
