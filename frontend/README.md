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

The dev command uses a dependency-free Node HTTP server (Node.js 20+ required for separate Set-Cookie forwarding) with a **development-only same-origin proxy** for explicitly allowlisted real auth endpoints. By default it forwards them to FastAPI at `http://localhost:8000`, avoiding browser CORS failures on `localhost:5173`. `npm run build` emits `dist/` without installing packages.

## Adapter boundary

`src/adapter.js` is an internal, provisional presentation adapter and **not** a FastAPI contract. `src/mock.js` supplies its UI-facing projection (`snapshot`) and command results (`send`). Replace the gateway with a real, authenticated adapter once owner-defined HTTP/WebSocket interfaces exist. The real adapter must provide authoritative Room and Player views, decision context, private grants and absolute deadlines, immutable request results, view semantic versions and reliable resync on event gaps.

Mock modes are explicitly constrained: **registration, verification-code sending, login, session restore and logout use the real FastAPI API client**, an **independent demo-only entry** creates a local fixture rather than registering or logging in, real password recovery/email verification/changes/deletion never succeed, no cross-tab/cross-device server coordination is claimed, no remote players actually act, hidden-hand equality and multi-card Replace are never guessed, Peek/Spy/Swap target authorization is rejected, score summaries are illustrative. Single-card Replace uses illustrative public discard values, not a true deck engine. A received accepted Mock outcome does **not** indicate a real FastAPI operation succeeded.

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

Registration, login, session restore and logout use **real HTTP calls**, not MockGateway. Rooms, game actions and connection takeover remain a strictly separate Mock demonstration until real Room/Game APIs are implemented.

### API base URL configuration

By default, a static production build sends requests to `http://localhost:8000`. In **local dev**, `npm run dev` serves the frontend on `http://localhost:5173`, injects the same-origin API base for the two registration endpoints, and proxies those POSTs to FastAPI at `http://localhost:8000`. You can override the public API address by declaring `window.CABO_API_BASE_URL` **before** the app module loads. Example for local staging:

```html
<script>window.CABO_API_BASE_URL = 'https://api.example.test';</script>
<script type="module" src="/src/app.js"></script>
```

Place this in your deployment-specific `frontend/index.html` before the existing module script, or set it using your deployment HTML configuration. The dev proxy target can be changed via `CABO_BACKEND_URL=https://your-api-host npm run dev`, and its local port via `PORT=5173`. The dev proxy forwards only the explicitly listed Auth and Phase 6-6-A Room endpoints documented below; it is not a generic reverse proxy. Only an http(s) **origin** is supported (no API suffix, credentials, query or fragment). This configuration is not a credential or session field. If a **static deployed frontend** connects directly to a different host/port, **FastAPI must permit the browser origin via CORS**; this PR does not alter backend CORS policy. The localhost dev proxy avoids that requirement during local registration development. A remotely hosted frontend cannot reach the visitor's localhost unless FastAPI is running on that visitor's machine.

### Endpoints

- **Send code**: `POST /auth/verification-codes` with `{"email_address":"alice@example.com","purpose":"registration"}`; only HTTP **202** is accepted.
- **Register**: `POST /auth/register` with `{"username":"Alice","email":"alice@example.com","password":"...","verification_code":"012345"}`; only HTTP **201** with the public Account fields is accepted.
- Existing UI `nickname → username` and `code → verification_code` mapping is kept inside `src/auth-api.js`. Password confirmation is checked in UI but **not transmitted**.
- The Auth client maps backend codes `USERNAME_TAKEN`, `EMAIL_ALREADY_REGISTERED`, `VERIFICATION_CODE_RATE_LIMIT`, `EMAIL_SEND_ERROR`, `INVALID_VERIFICATION_CODE`, `INVALID_USERNAME` and `INVALID_EMAIL_ADDRESS` to readable messages, with fallback HTTP 400/409/422/429/5xx handling. No raw backend error detail, password, or verification code is logged or persisted.
- A 201 response renders a separate success state and a **返回登录** action. Real login and Cookie Session restoration are now implemented independently; the separate Mock demo entry continues to function.

### Local integration

1. Start the backend (PostgreSQL migrations and email sending configuration must be working) at `http://localhost:8000`.
2. In `frontend/` run `npm run dev`, then open `http://localhost:5173`.
3. Choose **注册账号**, enter the unique registration name, email, password and matching confirmation.
4. Click **发送验证码**, confirm HTTP 202 in the browser Network panel, and receive the real email. Enter its numeric code and click **验证并注册**; confirm HTTP 201 and the **返回登录** page.
5. Test a duplicate name/email (409), code rate limit (429), invalid/expired code (400) and delivery failure (503). Then test the real login and Cookie Session restoration described below.

Run `npm run check && npm test && npm run build` for frontend code validation.

## Registration UI: resend cooldown and password confirmation

After `POST /auth/verification-codes` returns the expected HTTP **202**, the frontend disables the `发送验证码` button for **60 seconds** and shows `60秒后重发`, counting down to `1秒后重发`. The button re-enables after the deadline. This cooldown is a presentation safeguard only: FastAPI independently enforces its authoritative rate limit. A failed send or network error does **not** pretend to be a successful send or start a resend cooldown; the operation error is displayed.

The `确认密码` field checks against `密码` **as the user types**. Mismatch feedback is shown immediately after the confirmation input becomes nonempty; it clears automatically when both fields match, and re-evaluates if the original password is edited. Form submission still rejects a mismatch and sends only the password (never the confirmation). The expiry time lives in page memory and survives ordinary frontend rerendering, without localStorage or secret persistence. A full page reload does not replace the backend's rate limit.

## More visible registration feedback

The registration form now uses themed inline feedback close to the relevant field, without changing the CABO table/ parchment design: muted gold for requests in progress, dark green for accepted code requests and successful registration, and warm burgundy for errors such as `EMAIL_ALREADY_REGISTERED`, name conflicts, invalid codes or rate limiting. A password confirmation mismatch is also emphasized on the field border. Errors use an accessible alert role; informational and success states use polite status announcements. The resend countdown button stays legible while disabled. The Mock status notice follows the same restrained success/error colors but remains separate from real registration requests. All backend result/authorization semantics are unchanged.

## Signup label and confirmation warning

The signup field is now simply labeled **昵称** with the placeholder **设置昵称（不可重复）**. This is presentation terminology only: the value still maps from the frontend `nickname` to backend `username`, and AUTH-18-R1 requires that nickname/game display name be globally unique. The confirmation-password mismatch uses a stronger CABO-themed burgundy warning panel with an exclamation marker and highlighted input border, announced via the existing accessible live status; the message clears when the two passwords match.

## Real email/password login and HttpOnly Cookie Sessions

- `src/auth-api.js` adds `login({email,password})` (POST `/auth/login`, 200), `getMe()` (GET `/auth/me`, 200), and `logout()` (POST `/auth/logout`, 204). All three use `credentials:'include'` so the browser, not JavaScript, handles HttpOnly `session_token` cookies. Existing registration calls and their error handling remain intact.
- On boot the UI shows **正在检查登录状态** until GET `/auth/me` resolves. HTTP 200 restores the public account (username/email); HTTP 401 shows the real login form. Network/5xx shows **认证服务暂不可用** with a retry action, not a false logout. No account or token is stored in localStorage.
- Real login errors are surfaced alongside the login form without clearing its email field: `INVALID_CREDENTIALS` / 401, `INVALID_COOKIE` / 401, `TOO_MANY_REQUESTS` / 429, untrusted Origin / 403, 5xx and network failures. Login submits are deduplicated while pending.
- Authenticated UI displays only the public real account fields and **游戏功能尚未连接服务器**. It deliberately grants **no** Mock Room/Game authority. **进入本地 Mock 演示** remains an independent, explicitly labeled fixture; entering it does not place the real account into MockGateway.
- Real logout uses POST `/auth/logout`. A 204 or expired-session 401 clears local public-account UI state; network/5xx retains the local state and warns that server revocation is unconfirmed. Mock demo logout is unaffected.
- The frontend dev server at `http://localhost:5173` proxies only POST `/auth/verification-codes`, POST `/auth/register`, POST `/auth/login`, GET `/auth/me`, POST `/auth/logout`, and optional POST `/auth/refresh` to the configured FastAPI origin (`http://localhost:8000` by default). It passes browser `Cookie` and the **actual** browser `Origin` on POST requests (never fabricates an Origin), forwards separate `Set-Cookie` values as multiple headers, and preserves backend statuses/errors. It never logs credentials. Production must provide an equivalent trusted-origin/CORS/proxy configuration.
- FastAPI's configured `allowed_origins` must include the real browser origin (normally `http://localhost:5173` for this proxy). For production use HTTPS; during local development, verify the browser accepts the backend's `Secure` cookie setting over `localhost`, or use an explicit development-only server configuration. Browser devtools may display HttpOnly attributes, but application JavaScript must never read them.

### Manual cookie-auth integration (requires running backend and browser)

1. Start FastAPI plus its PostgreSQL database at `http://localhost:8000` and run `cd frontend && npm run dev`; open `http://localhost:5173` (use this exact hostname consistently).
2. Register a verified account with the existing email-code flow, click **返回登录**, and log in with the same email/password; the real account page must show username/email, with no real game access.
3. Inspect the browser Network/Application panels: POST `/auth/login` should return 200 with an HttpOnly `session_token` cookie; do not copy its value. Reload and verify GET `/auth/me` returns 200 and the account is restored.
4. Try an incorrect password (401 / `INVALID_CREDENTIALS`), repeated attempts (429 / `TOO_MANY_REQUESTS`), and an expired/invalid session (401 / `INVALID_COOKIE`), confirming meaningful errors.
5. Click **退出登录**. POST `/auth/logout` should return 204 and clear the cookie; subsequent GET `/auth/me` should return 401. Simulate a network failure during logout and verify the UI does **not** falsely claim server-side revocation.
6. Independently click **进入本地 Mock 演示** and verify it continues to use a synthetic identity, not the real account.

Run `npm run check && npm test && npm run build` for frontend-only checks. Automated tests include isolated HTTP client semantics and a local fake-FastAPI proxy test; they cannot prove a production Cookie/Secure/Origin configuration without a real browser and backend.

## Phase 6-6-A · Real Room HTTP client

`src/room-api.js` exposes `createRoomApi({baseUrl?,fetchImpl?})`. It reuses the existing `getAuthApiBaseUrl()` configuration and browser-owned HttpOnly Session cookies (`credentials: 'include'`), and is now used by the **separate real Room interface** in `app.js` (Phase 6-6-B). The original Room/Game Mock interface remains an independent local demonstration. No real Account is assigned to a Mock player.

| Client method | HTTP method / path | Expected |
| --- | --- | --- |
| `createRoom()` | POST `/rooms` | 201 RoomResponse |
| `joinRoom(roomCode)` | POST `/rooms/join` | 200 RoomResponse; `{room_code: roomCode}` |
| `getRoom(roomId)` | GET `/rooms/{room_id}` | 200 RoomView |
| `setReady(roomId, ready)` | PUT `/rooms/{room_id}/ready` | 200 RoomReadyResponse; `{ready}` |
| `leaveRoom(roomId)` | POST `/rooms/{room_id}/leave` | 204, returns `null` |
| `kickMember(roomId, accountId)` | POST `/rooms/{room_id}/members/{account_id}/kick` | 204, returns `null` |
| `disbandRoom(roomId)` | POST `/rooms/{room_id}/disband` | 204, returns `null` |

The client verifies exact HTTP success status and required public response shape. Errors are `RoomApiError` with `status`, sanitized backend `code`, and `outcomeUnknown`. Network failures and 5xx on writes are **indeterminate** (the server may have committed the operation); the future UI must refresh the authoritative Room view before deciding whether to retry. This is not a client-side substitute for server-side Room membership, Host, Ready or Game rules. No secret values are logged or saved.

The dev server forwards **only** these seven exact Room route shapes alongside the existing Auth allowlist. Dynamic `room_id` and `target_account_id` must match the canonical hyphenated UUID text pattern; other `/rooms/` paths never reach FastAPI. Both POST and PUT forward the actual browser `Origin`, and requests with cookies forward the browser `Cookie`. The proxy supports JSON bodies where supplied, correctly forwards multiple `Set-Cookie` values and the upstream HTTP code/body, and retains the 64 KiB request cap and 15-second timeout. `CABO_BACKEND_URL` continues to select FastAPI's origin.

To check Phase 6-6-A independently of the real Room UI, start FastAPI and the frontend dev server, then import the module from a temporary browser console or a development-only ES module:

```js
import {createRoomApi} from '/src/room-api.js';
const rooms=createRoomApi();
const created=await rooms.createRoom();
// After authorization, use created.id with getRoom/setReady/leaveRoom.
// Do not test disband/kick on production rooms without authorization.
```

The browser must already have a valid Auth Session, and FastAPI must trust the real browser Origin. Run `npm run check && npm test && npm run build` under `frontend/`; the new unit and proxy integration tests do not require a live PostgreSQL server. End-to-end server permission and concurrent Room business rules still require separate backend/browser testing.

## Phase 6-6-B · Real Create / Join / authoritative read-only Room View

After real FastAPI authentication, the account page now offers **创建房间** and a **six-character room code** Join form. The frontend normalizes the code to uppercase before `joinRoom(roomCode)`; it accepts only the backend's alphabet `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`. Successful Create (201) / Join (200) returns a server-issued Room ID, which is then passed to `getRoom(id)`. Only a successful authoritative GET displays Room members. A pending or failed GET never invents a host, seat or Ready flag.

The real Room view displays the returned code, state, host account ID, member count, and all member usernames, **server-supplied** `seat_index`, `is_host` and `is_ready`, sorted by `seat_index`. The "你" marker compares `member.account_id` with the authenticated `realAccount.id`; it never substitutes `demo-me`. **刷新房间** performs an explicit GET; Phase 6-7-C1 also enables WebSocket-triggered authoritative GETs. There is no automatic polling.

**Room navigation recovery:** the only persisted value is `sessionStorage['cabo.lastRealRoomId']`, a non-authoritative UUID locator. After `GET /auth/me` returns 200, the frontend reads this UUID and re-checks access using `GET /rooms/{id}` before displaying members. When GET returns 403 or 404 it clears that UUID and returns to the Create/Join entrance. A network error or 5xx retains the UUID for manual refresh and does not imply the Room was deleted; a previously visible Room View is marked stale. Confirmed logout (204 or expired session 401) clears the locator and in-memory Room state. Pending responses are invalidated on reset, so a late GET or Create response cannot restore state after logout. SessionStorage may be disabled: in that case Create/Join still works within the current page but navigation will not survive a reload.

For a Create/Join network failure (`RoomApiError.outcomeUnknown`) the UI **never retries a write automatically** or invents a Room ID. It disables repeated Create/Join and explicitly warns that the operation might have committed. It provides **重新验证登录状态**, but this is not a Room discovery endpoint: without a Room ID in the response and without a backend "my room" query, an indeterminate Create cannot be reliably located. When the server returned a Room ID but the subsequent GET failed, the UUID remains available and the user can retry the read-only GET. A Room GET 401 triggers a separate `/auth/me` revalidation instead of trusting the old Room display.

**Phase 6-6-B originally included only read-only Room operations**; Phase 6-6-C (below) subsequently added Ready, Leave, Kick and Disband. Start Game and gameplay remain unimplemented; notification-only WebSocket support was added in Phase 6-7-C1. The original `MockGateway` and its demo interface have not been modified, and real accounts never enter Mock rooms.

### Manual two-account acceptance

1. Run FastAPI/PostgreSQL and the frontend dev proxy. Use two independent browser sessions with valid HttpOnly cookies for two verified accounts.
2. Account A: click **创建房间**; verify POST `/rooms` returns 201 followed by GET `/rooms/{id}` 200. Copy the displayed six-character `room_code`.
3. Account B: enter that code (lowercase is accepted) and click **加入房间**. Verify POST `/rooms/join` 200 followed by GET 200. Both accounts click **刷新房间** to see both authoritative members.
4. Reload both tabs. Check that `/auth/me` restores each real identity and that `/rooms/{id}` revalidates membership from the stored UUID locator; verify Member/Host/Ready fields.
5. Test invalid code, 403/404 (navigation cleared), 409, 422, 5xx and network disruption (navigation retained or write uncertain as applicable). Confirm the independent **进入本地 Mock 演示** button does not transfer the real account to the demo game.
6. From the real account UI, log out and confirm the Room UUID locator is removed. Verify a delayed response cannot recreate the logged-out Room view.

Run `cd frontend && npm run check && npm test && npm run build`. Automated tests simulate the state and API but cannot replace real two-account browser and database integration.

## Phase 6-6-C · Real Lobby management (Ready / Leave / Kick / Disband)

The authenticated Room UI now exposes **Ready / Unready** to a *non-Host member*, **Leave** to any member, **Kick** to the Host for other non-Host members, and **Disband** to the Host. Buttons require a recently verified, non-stale FastAPI Room View with `state === 'Lobby'` and current `realAccount.id` appearing in `members`. This client-side gating is a presentation safeguard only; FastAPI remains the authority for Room permissions and state.

- Ready calls `PUT /rooms/{id}/ready` with `{ready: !myMember.is_ready}`, then, **only after HTTP 200**, GETs the authoritative Room View. UI never optimistically flips Ready. Host has no Ready button.
- Leave requires confirmation. Host receives the explicit warning **「你是房主，离开将解散整个房间，所有成员都会退出。确定继续吗？」**; non-Host gets a regular Leave confirmation. Only HTTP 204 resets the in-memory Room and the sessionStorage UUID; the auth cookie remains untouched.
- Kick requires Host + target member currently in Room View, disallows self and Host targets, and requires a dialog that names the exact member. HTTP 204 is followed by GET Room; no client-side removal from the member list. A target 404 asks the Host to refresh.
- Disband is Host-only, uses a danger confirmation **「解散后房间将关闭，所有成员退出，无法恢复。确定解散吗？」**, and clears Room state/navigation **only after HTTP 204** without a follow-up GET.

While a write or follow-up GET is pending, all Lobby mutation controls are disabled; there is one operation at a time. A successful Ready/Kick write followed by GET failure is reported as **「操作可能已完成，但暂时无法确认最新房间状态，请刷新房间。」** and marks the old view stale, blocking further writes until an authoritative GET succeeds. Network failure/5xx during a write also retains the Room UUID and marks the result unknown; the UI never auto-retries. GET 403/404 revokes invalid navigation, 401 triggers a separate authentication recheck, and confirmed real logout invalidates late Room responses. Error feedback does not display cookies, token values or backend exception internals.

No real Game Start, Ready-to-Start action, automatic polling or gameplay is included. Phase 6-7-C1 adds notification-only Room WebSockets. MockGateway, Auth API protocol, database and FastAPI are unchanged.

### Phase 6-6-C manual integration

With two independent authenticated browser sessions in the same Room, verify guest Ready → GET, Unready → GET and Leave → 204, and Host Kick → 204 → GET, Leave (with disband warning) → 204 and Disband → 204. Confirm that guests never see Kick/Disband and Hosts never see Ready. Simulate write failure or follow-up GET outage, verify stale/unknown warning and manual refresh rather than duplicate writes. Run `cd frontend && npm run check && npm test && npm run build` prior to merging.

## Phase 6-6-D · Real dual-account integration audit

See [ROOM_INTEGRATION_ACCEPTANCE.md](./ROOM_INTEGRATION_ACCEPTANCE.md) for the **not-yet-executed live browser / FastAPI / PostgreSQL** acceptance ledger, prerequisites, non-sensitive evidence guidelines, recovery/negative scenarios and cleanup rules. Source-level tests do not prove that two independent browser sessions can complete the Room lifecycle against an actual database. The latest UI accurately reflects Phase 6-6-C Lobby controls; the post-Ready/Kick authoritative GET 403/404 case no longer offers a refresh after its Room locator has been revoked.

## Phase 6-7-C1 · Real Room WebSocket change notifications

After a real Account has received a successful, authoritative `GET /rooms/{room_id}` (following Create, Join, restore, or manual Refresh), the frontend opens one WebSocket to `/ws/rooms/{room_id}`. The backend authenticates the WebSocket handshake with the **browser-owned HttpOnly session cookie** and validates the browser's real `Origin`. The frontend never reads or forwards the session token itself.

The socket carries **notifications, not Room state**. Only valid JSON `{"type":"room.changed","room_id":"<current room UUID>"}` triggers an additional `getRoom(roomId)`; that GET alone replaces the displayed authoritative Room View. Invalid JSON, other event types, and stale/other-room IDs are ignored. Notifications that arrive while a Room HTTP operation is pending are coalesced into at most one additional GET after the pending operation completes. A **server-initiated WebSocket close**, including the backend's code 1008 on Kick, Host Leave or Disband, also queues one authoritative GET before deciding whether Room access still exists. If GET returns 403/404, the stale Room locator and Room View are removed and the entrance explains that Room access ended; if GET returns 200 the Room remains visible. A normal network disconnect is not itself evidence of Kick. Client-initiated close (Leave, logout, Mock switch, Room switch) never triggers this verification. A close during an in-flight GET defers verification and prevents its older response from replacing Room state. The closed connection is **not automatically reconnected**. There is **no automatic reconnect**, heartbeat or polling. WebSocket-triggered GET requests are **silent**: no temporary loading status, toast, stale banner or full-page redraw; only a genuinely changed Room section is updated once. An unchanged view produces no UI update. Transient background GET failures retain the last view without flashing an error; manual **刷新房间** remains available and surfaces failures normally. Authorization loss (401/403/404) is still handled immediately. The **刷新房间** button also remains available if a notification is missed or the socket closes.

Only one socket per verified real Room is maintained. Confirmed Leave/Disband, revoked Room access (GET 403/404), real logout, account switching, a changed Room ID, page unload and switching to local Mock demonstration close the old socket. Late events and late HTTP results are ignored after Room reset or switching; MockGateway and gameplay remain independent.

**Development origin:** `npm run dev` serves HTTP requests on `http://localhost:5173` through the existing Node HTTP proxy but does **not** implement a WebSocket Upgrade proxy. It injects `window.CABO_ROOM_WS_BASE_URL` from the configured `CABO_BACKEND_URL` (default `http://localhost:8000`) into the page, so browser WebSockets connect **directly to FastAPI** while HTTP Room API calls continue through the same-origin frontend proxy. Production without this development injection defaults WebSocket origin to the configured `window.CABO_API_BASE_URL`. The URL helper chooses `ws:` or `wss:` from page/API security context and never hardcodes a hostname. Backend `allowed_origins` must trust the actual browser origin (`http://localhost:5173` for development), and the browser must send the cookie to FastAPI's host. Keep the hostname consistent (`localhost` vs `127.0.0.1`), and use HTTPS/WSS in production.

### Manual two-browser notification verification

1. Start isolated FastAPI + PostgreSQL and `cd frontend && npm run dev`. Sign in as Alice and Bob in **separate browser profiles**; confirm cookies are HttpOnly without copying their values.
2. Alice creates a Room. In her browser's Network → WS panel, verify one accepted `ws://localhost:8000/ws/rooms/{id}` handshake (or the configured origin). Bob enters the same code and joins.
3. Without Alice pressing **刷新房间**, verify Bob's join causes a `room.changed` frame in Alice's socket and a **fresh GET** `/rooms/{id}`; Alice's member list updates from that HTTP response.
4. Bob toggles Ready/Unready; verify Alice's view updates on notifications/GET. Kick Bob as Alice; Bob's next GET must reject access and clear navigation. Note: the backend may close a kicked user's socket before sending a further notification, so also verify Bob's manual Refresh fallback.
5. Independently verify guest Leave and Host Disband/Leave close the affected sockets and that remaining members update after server notifications where delivered.
6. Refresh a browser page with a stored Room ID: after `GET /auth/me` and a successful `GET /rooms/{id}`, a new socket should be established exactly once. A 403/404 must not reconnect it.
7. Switch to **进入本地 Mock 演示**: the real socket must close and no Mock actions should trigger real Room GETs. Check manual Refresh remains usable on the real Room screen. Verify logout and account switching close sockets.
8. Verify HTTPS deployment opens `wss:` with a trusted Origin and valid session cookies. No automatic reconnect is expected if the connection closes.

These steps require a running browser + FastAPI and are **not proved** by mocked WebSocket/unit tests.

### WebSocket close / access revocation regression checklist

In a test FastAPI/PostgreSQL environment, sign in Alice (Host) and Bob (member) in separate browser profiles, enter the same Room and inspect Bob's Network → WS and HTTP requests without copying Cookie values:

1. Alice Kicks Bob: Bob's socket closes with code **1008**, Bob issues a fresh `GET /rooms/{id}`, the server rejects membership (403/404), and Bob automatically returns to the Create/Join entrance with a Room-access message. No manual refresh is needed.
2. Host Disband and Host Leave in separate test Rooms: each other member receives a socket close, rechecks membership via GET, and leaves the now-inaccessible Room UI.
3. Bob leaves normally: his own local `socket.close()` must not issue a second GET; Alice still receives notifications and refreshes normally.
4. Force an unexpected network WS disconnect while the Room and HTTP API are still accessible: GET 200 retains the Room. The client does not automatically reconnect; manual **刷新房间** continues working.
5. Switch Rooms or log out during close/GET activity: old connection events and any delayed GET result must not restore the old Room.
6. Force a close during a pending Room GET: the pending response is ignored; the queued follow-up GET determines current access. Verify that neither stale members nor a spurious kick message appear.

These are manual integration instructions, **not evidence of an executed two-account E2E test**.

## Lobby interaction flicker fix

In addition to silent WebSocket `room.changed` GETs, **user-initiated Ready / Unready / Kick / Leave / Disband** now avoid full-page re-renders while their HTTP requests are pending. Ready/Kick's acknowledged-write follow-up GET is quiet; no transient `正在更新准备状态`, `正在踢出成员`, or `正在同步服务器房间信息` banner is shown. Mutation controls are still visibly disabled during the operation, and the backend Room View remains authoritative (no optimistic Ready or member removal). The existing Room section is reconciled in place, with member DOM keyed by `account_id`; unchanged cards, seats, scroll position, account info, and buttons are retained. Real Room confirmation dialogs are inserted/removed independently of the page, rather than rebuilding the entire shell.

A **successful Leave / Disband** must still change the Room section from Room View to the Create/Join entrance, but now performs one Room-local DOM update without rebuilding the account page. Genuine errors and server-revoked Room access remain visible; manual Refresh retains its explicit feedback. No changes to Auth, MockGateway or backend behavior.

### Phase 6-7-C1: missed WebSocket close fallback on return to the page

The backend closes the kicked member's WebSocket with code `1008`, and the existing `onclose` handler performs an authoritative Room GET. If that close event never arrives (for example, the socket handshake failed earlier or the connection was already absent), the frontend cannot receive a push notification. The real Room page now **silently revalidates once when its browser window regains focus or its tab becomes visible**, without creating a timer, polling continuously or reconnecting the socket. A 403/404 clears the old Room UUID and Room View and returns the player to the Create/Join entrance. A 200 keeps the Room. Focus/visibility events close together are coalesced, and an already pending GET is not allowed to overwrite the newer verification result. Mock mode, logout and pages without a verified Room do not initiate these checks.

**Live diagnosis if Kick is still not immediate:** in the kicked player's browser, inspect Network → WS for a successful `/ws/rooms/{room_id}` handshake and a close code `1008`. Check whether a GET `/rooms/{id}` follows and returns `403` (or `404`, as applicable). Observe methods, URLs, status codes and the presence/attributes of Cookie and Origin only; **never copy Cookie values**. The backend `RoomConnectionManager` is an **in-memory manager local to one FastAPI worker**; if the HTTP Kick and WS connection use different server processes or instances, HTTP may succeed while that process's connection manager has no socket to close. This requires deployment/process configuration diagnosis and is not solved by frontend notification handling. For local tests use a single FastAPI worker and the same `localhost` host for frontend and backend. No timer/heartbeat/reconnect is introduced here.
