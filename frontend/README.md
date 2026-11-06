# CABO frontend · constrained Mock

This directory is a standalone **dependency-free vanilla ES modules** frontend; there was no existing frontend in `main` when work began. No backend, database, frozen documents or root files are modified.

## Running

```sh
cd frontend
npm run dev
npm run check
npm test
npm run build
```

The dev command uses Python’s built-in HTTP static server. `npm run build` emits `dist/` without installing packages.

## Adapter boundary

`src/adapter.js` is an internal, provisional presentation adapter and **not** a FastAPI contract. `src/mock.js` supplies its UI-facing projection (`snapshot`) and command results (`send`). Replace the gateway with a real, authenticated adapter once owner-defined HTTP/WebSocket interfaces exist. The real adapter must provide authoritative Room and Player views, decision context, private grants and absolute deadlines, immutable request results, view semantic versions and reliable resync on event gaps.

Mock modes are explicitly constrained: the login form does not authenticate against a real provider, email-code registration and mail sending are explicitly rejected (no Verified Account is fabricated), an **independent demo-only entry** creates a local fixture rather than registering or logging in, real password recovery/email verification/changes/deletion never succeed, no cross-tab/cross-device server coordination is claimed, no remote players actually act, hidden-hand equality and multi-card Replace are never guessed, Peek/Spy/Swap target authorization is rejected, score summaries are illustrative. Single-card Replace uses illustrative public discard values, not a true deck engine. A received accepted Mock outcome does **not** indicate a real FastAPI operation succeeded.

Use Alt+Shift+M in the app for a takeover demo; reopening/reclaiming is available through adapter command. Programmatic `gateway.send('disconnect'/'reconnect'/'expireSession'/'takeover'/'reclaim')` enables isolated scenario tests. No secrets are persisted to LocalStorage.

## Contract caveats

This UI never represents a complete implementation of Phase 4 game rules, authoritative timeout defaults, multi-account room management, authentication or security. Those flows require a backend rather than being faked by a browser-only Mock. The fixed mock game clock is local for demo only; a future adapter must use server-provided absolute deadlines.

## Registration email-code contract (AUTH-5-R1)

Registration now displays email, password, numeric email verification code, a send/resend action and the final register action. The real backend must validate an ephemeral registration verification context (normalized email, purpose, expiry, replacement of previous codes, one-time consumption, abuse controls) and atomically enforce email uniqueness when completing registration; success creates a **Verified** account but does not automatically grant Room identity. The documents intentionally do not specify a fixed number of digits, cooldown duration, endpoint path or error-code schema.

Until the owner implements the real email and registration adapter, both `requestRegistrationCode` and `register` reject with a local `MOCK_LIMIT` indication. No email is sent and no Account or Session is created. The independent **进入本地 Mock 演示** button activates an explicitly labeled fixture for other UI scenarios without claiming registration, email ownership or true authentication.

## Authentication screen navigation and nickname

- Login shows only **注册账号** and **忘记密码？** navigation links; other authentication forms return to login.
- Registration collects a required **游戏昵称** alongside email, password and numeric email code. The temporary frontend adapter payload calls it `nickname`; this is **not a ratified FastAPI field name**.
- A nickname is a non-unique display label, not an Account ID, Room Member ID or authorization credential. Server-side normalization and validation remain backend responsibilities. Registration remains unavailable in Mock mode until real email proof and atomic Verified-account creation exist.
