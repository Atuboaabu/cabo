# Phase 6-6-D · Real two-account Room integration acceptance

**Status:** NOT EXECUTED against a live browser, FastAPI or PostgreSQL in this development environment. This is an executable manual acceptance checklist, not evidence of successful E2E testing. Unit tests and a fake FastAPI proxy are not a substitute for a database-backed test.

## Preconditions (safe, isolated test environment)

- Use an isolated **development/test PostgreSQL database**, with migrations applied, and a running FastAPI instance at `http://localhost:8000`. Do **not** run against production or delete existing accounts.
- Use two **pre-authorized test accounts** (Alice and Bob), provisioned explicitly for this test, with verified email and passwords. If accounts are unavailable, stop and request test credentials/configuration through an approved secret-management channel. Do not create real accounts or generate unexpected mail to actual users.
- Backend `allowed_origins` must include `http://localhost:5173`; the browser must consistently use `http://localhost:5173`, not `127.0.0.1`. Start the frontend with `cd frontend && npm run dev`; the proxy sends Room requests to `CABO_BACKEND_URL` (default `http://localhost:8000`).
- Use **two separate browser profiles/contexts** for Alice and Bob (not two tabs sharing the same Cookie jar). Confirm the accounts are different by observing the public username and email in each UI.
- Inspect HTTP **status, method, path, Origin, Request Payload, and Cookie attributes only** in DevTools. **Never copy, record, print or persist Cookie values, passwords, codes, Authorization headers or private account data.** Save screenshots/logs only after redacting sensitive fields.
- Only clean up Rooms created expressly for this test, through normal Room UI operations; do not delete database rows or real user data.

## Real browser + FastAPI + PostgreSQL acceptance ledger

Mark each test PASS/FAIL/BLOCKED. Record non-sensitive observations such as Room code, HTTP status and a generic issue reference (avoid session values). Any step not actually executed remains **NOT RUN**.

| # | Alice (Host) / Bob (member) browser action | Expected authoritative result |
|---|---|---|
| 1 | Log in independently in Alice and Bob browser profiles | POST `/auth/login` 200 in each; HttpOnly Cookie set by browser, no JS-readable session token; GET `/auth/me` identifies separate accounts |
| 2 | Alice clicks **创建房间** | POST `/rooms` 201; GET `/rooms/{room_id}` 200; displayed **six-character server room code**, Lobby, Alice Host, Alice seat from server |
| 3 | Bob enters Alice's code (lowercase accepted) and clicks **加入房间** | POST `/rooms/join` 200 with the same server Room ID; GET `/rooms/{room_id}` 200 |
| 4 | Both click **刷新房间** | Two independent GETs 200; both see Alice + Bob and identical server `seat_index`, `is_host`, `is_ready`; Host Alice, non-Host Bob |
| 5 | Reload both browser pages | GET `/auth/me` 200, then GET `/rooms/{room_id}` 200 using only sessionStorage Room ID for *navigation*; no membership is displayed before GET verifies access |
| 6 | Bob clicks **准备**; Alice refreshes | Bob PUT `/rooms/{id}/ready` payload `{"ready":true}` → 200, then Bob GET 200; Alice GET 200 shows Bob `is_ready:true` |
| 7 | Bob clicks **取消准备**; Alice refreshes | Bob PUT payload `{"ready":false}` → 200, then Bob GET 200; Alice GET 200 shows Bob `is_ready:false` |
| 8 | Alice clicks **踢出** Bob and confirms | POST `/rooms/{id}/members/{bob_id}/kick` 204; Alice GET 200 excludes Bob. No local optimistic deletion |
| 9 | Bob clicks **刷新房间**, then reloads | GET `/rooms/{id}` returns **403** (no longer member) or documented 404 where applicable; Bob's old sessionStorage locator is cleared, no Room View shown; Alice still sees Room |
| 10 | Bob creates or joins another *test* Room | POST `/rooms` 201, or POST `/rooms/join` 200 (to an independently authorized test Room); Bob is not stuck in his old Room. Close any extra test Room normally |
| 11 | Alice confirms **解散房间** | POST `/rooms/{id}/disband` 204; Alice Room state and stored locator cleared; a subsequent attempt to join the **old room code** is rejected |
| 12 | Alice clicks **创建房间** again | POST `/rooms` 201, new Room ID and code; Alice GET Room 200; then Alice uses a confirmed test-only Leave/Disband cleanup |
| 13 | Separate scenario: Alice creates another test Lobby, Bob joins, Alice clicks **离开房间** and confirms Host disband warning | POST `/rooms/{id}/leave` 204; Room closes; Bob's next GET rejects access or indicates closed state per backend contract; former members can join/create fresh Rooms |
| 14 | Negative tests: invalid Room code, wrong Room ID, non-Host disband attempt (API-level), duplicate Join, 409 conflicts | Actual HTTP 403/404/409/422 appropriately mapped; no success UI or unauthorized Room display |
| 15 | Interrupt a Room mutation response or the following GET in the isolated test environment | No automatic write retries; uncertain mutation stays unknown, Room ID retained; acknowledged Ready/Kick followed by GET 5xx displays refresh guidance and blocks writes until GET 200 |
| 16 | Verify browser Origin and session behavior for Ready and all Lobby mutations | Browser sends `Origin: http://localhost:5173` on POST and PUT; proxy passes Origin and Cookie upstream without fabrication; multiple Set-Cookie remain independent; all 204s are handled without parsing JSON |

**Important server behavior:** `get_room_info` verifies active membership using `RoomMember.left_at IS NULL`. After Kick, the former member is rejected by the backend; the persisted Room locator is not an authorization token. The backend additionally enforces Room role/state checks and is authoritative over whether closed Room codes can be joined.

## Automation executed separately

`frontend/tests/real-lobby-actions.test.js`, `real-room-state.test.js`, `real-room-ui.test.js`, `room-api.test.js`, and `dev-proxy.test.js` provide simulated API/UI/proxy coverage, **not a live two-account integration pass**. Run in a complete checked-out repository:

```sh
cd frontend
npm run check
npm test
npm run build
```

Record the actual output and exit codes before reporting those three as passed. In this environment a fresh checkout could not be obtained because `github.com` did not resolve, so these `npm` commands could not be run against the latest main/PR branch.

## Known limits and potential risks

- Without a backend **current Room by account** endpoint, an indeterminate Create response that lost its Room ID cannot be recovered automatically. Do not retry the write blindly.
- Browser Cookie policies (`Secure`, same-site, localhost), backend trusted Origin configuration and PostgreSQL migrations require real environment validation.
- A UI button being hidden does not enforce authorization; server checks must be verified with real sessions.
- A Room lookup after Ready/Kick can return 403/404 because access was revoked during the operation; the frontend should clear navigation and show an actionable message instead of suggesting refresh when no Room ID remains.
- No automatic polling/WebSocket means member changes become visible when each user manually refreshes.
