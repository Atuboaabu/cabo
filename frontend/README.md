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

Mock modes are explicitly constrained: the login form does not authenticate against a real provider, **registration and verification-code sending use the real FastAPI API client instead of Mock**, an **independent demo-only entry** creates a local fixture rather than registering or logging in, real password recovery/email verification/changes/deletion never succeed, no cross-tab/cross-device server coordination is claimed, no remote players actually act, hidden-hand equality and multi-card Replace are never guessed, Peek/Spy/Swap target authorization is rejected, score summaries are illustrative. Single-card Replace uses illustrative public discard values, not a true deck engine. A received accepted Mock outcome does **not** indicate a real FastAPI operation succeeded.

Use Alt+Shift+M in the app for a takeover demo; reopening/reclaiming is available through adapter command. Programmatic `gateway.send('disconnect'/'reconnect'/'expireSession'/'takeover'/'reclaim')` enables isolated scenario tests. No secrets are persisted to LocalStorage.

## Contract caveats

This UI never represents a complete implementation of Phase 4 game rules, authoritative timeout defaults, multi-account room management, authentication or security. Those flows require a backend rather than being faked by a browser-only Mock. The fixed mock game clock is local for demo only; a future adapter must use server-provided absolute deadlines.

## Registration email-code contract (AUTH-5-R1)

Registration now displays the required globally unique registration/display name, email, password, numeric email verification code, a send/resend action and the final register action. The real backend must validate an ephemeral registration verification context (normalized email, purpose, expiry, replacement of previous codes, one-time consumption, abuse controls) and atomically enforce email uniqueness when completing registration; success creates a **Verified** account but does not automatically grant Room identity. The documents intentionally do not specify a fixed number of digits, cooldown duration, endpoint path or error-code schema.

The real registration form now calls FastAPI directly via `src/auth-api.js`, while `MockGateway` continues to reject its legacy registration commands. HTTP 202 means the code request was accepted; HTTP 201 with the public Account response means the account was created. The form then displays **注册成功 → 返回登录**; it does not invent an authenticated Session or enter a game Room. The independent **进入本地 Mock 演示** button activates an explicitly labeled fixture for other UI scenarios without claiming registration, email ownership or true authentication.

## Authentication screen navigation and nickname

- Login shows only **注册账号** and **忘记密码？** navigation links; other authentication forms return to login.
- Registration collects a required **注册名（游戏展示名）** alongside email, password and numeric email code. The provisional frontend adapter still calls the payload field `nickname`; this is **not a ratified FastAPI field name**.
- The registration name **is the account's game display name** and must be **globally unique across all current accounts**, both at registration and when changing it. It is not an Account ID, Room Member ID, login credential or authorization token. The server defines the canonical comparison and enforces uniqueness atomically with its PostgreSQL constraint, including concurrent registration and rename. Registration remains unavailable in Mock mode until real email proof and atomic Verified-account creation exist.

## Password confirmation (registration only)

Registration includes a required `确认密码` input. The frontend compares it with the password and blocks registration submission on a mismatch, showing native form validation feedback. It clears the validation error when either password field changes. The confirmation is **not** included in the adapter request, nor retained by Mock. Server-side password policy, account creation and verification of the registration email code remain solely backend responsibilities.

## AUTH-18-R1 · global registration/display-name uniqueness

- `注册名` and `游戏展示名` are one account attribute; they cannot be duplicated across registered accounts under the backend's defined canonical comparison rule. Renaming is allowed outside Playing only when the new name remains globally unique at the **authoritative commit**.
- A client-side free/occupied indicator is never sufficient: another account may register or rename concurrently. The backend must perform the final uniqueness check (including race cases) and reject conflicting requests without changing the original name, Account ID, Room Member, game participant or results.
- **Constrained Mock interactions**: the names `小林`, `阿南` and `晚风` are *known demo fixtures*, so a registration intent or rename using one returns `DEMO_NAME_CONFLICT`. This is **not** a backend name availability query or a global unique-name decision. Other valid registration intents and rename attempts return `MOCK_LIMIT` rather than falsely passing unique-name checks. An empty name returns `INVALID_INPUT`; changing to the current name returns `UNCHANGED`; changes while Playing return `PLAYING_LOCK`. Failed changes keep the original name and identities intact.
- Successful registration in the real flow requires a verified email plus the server's global email and display-name uniqueness checks. Pending or unverified new registrations do **not** create an Account or gain Room/Game privileges. The account settings UI no longer claims unverified email can participate.

## Real FastAPI registration integration

The registration screen uses **real HTTP calls**, not the Mock Gateway. The rest of the app (login, rooms and game) remains Mock-only until independent authentication/session contracts are implemented.

### API base URL configuration

By default, the browser sends requests to `http://localhost:8000`. You can override it by declaring `window.CABO_API_BASE_URL` **before** the app module loads. Example for local staging:

```html
<script>window.CABO_API_BASE_URL = 'https://api.example.test';</script>
<script type="module" src="/src/app.js"></script>
```

Place this in your local / deployment version of `frontend/index.html` before the existing module script, or set it using deployment-specific HTML. Only an http(s) **origin** is supported (no API suffix, credentials, query or fragment). This configuration is not a credential or session field. If the frontend runs on a different host/port, **FastAPI must permit that browser origin via CORS**; this PR does not alter backend CORS policy. A remotely hosted frontend cannot reach the visitor's localhost unless FastAPI is running on that visitor's machine.

### Endpoints

- **Send code**: `POST /auth/verification-codes` with `{"email_address":"alice@example.com","purpose":"registration"}`; only HTTP **202** is accepted.
- **Register**: `POST /auth/register` with `{"username":"Alice","email":"alice@example.com","password":"...","verification_code":"012345"}`; only HTTP **201** with the public Account fields is accepted.
- Existing UI `nickname → username` and `code → verification_code` mapping is kept inside `src/auth-api.js`. Password confirmation is checked in UI but **not transmitted**.
- The Auth client maps backend codes `USERNAME_TAKEN`, `EMAIL_ALREADY_REGISTERED`, `VERIFICATION_CODE_RATE_LIMIT`, `EMAIL_SEND_ERROR`, `INVALID_VERIFICATION_CODE`, `INVALID_USERNAME` and `INVALID_EMAIL_ADDRESS` to readable messages, with fallback HTTP 400/409/422/429/5xx handling. No raw backend error detail, password, or verification code is logged or persisted.
- A 201 response renders a separate success state and a **返回登录** action. Real login and session handling remain unimplemented by design; the separate Mock demo entry continues to function.

### Local integration

1. Start the backend (PostgreSQL migrations and email sending configuration must be working) at `http://localhost:8000`.
2. In `frontend/` run `npm run dev`, then open `http://localhost:5173`.
3. Choose **注册账号**, enter the unique registration name, email, password and matching confirmation.
4. Click **发送验证码**, confirm HTTP 202 in the browser Network panel, and receive the real email. Enter its numeric code and click **验证并注册**; confirm HTTP 201 and the **返回登录** page.
5. Test a duplicate name/email (409), code rate limit (429), invalid/expired code (400) and delivery failure (503). To test actual login, wait for the separate real login integration; the visible login form is still Mock-only.

Run `npm run check && npm test && npm run build` for frontend code validation.
