# QAssistant Capture Extension

Chrome MV3 extension that records QA sessions as DOM-replay (rrweb) with optional
viewport screenshots, lets the tester flag important states via a hotkey, and
uploads artifacts to object storage through backend-minted write-only signed URLs.

## Architecture

Three contexts (see `src/shared/messages.ts` for the typed protocol between them):

- `src/background/service-worker.ts` (the brain): owns auth tokens, the recording
  lifecycle, chunk upload, screenshots, and timers. Non-persistent; rehydrates an
  in-flight session from `chrome.storage.local` when woken.
- `src/popup/` (UI only): sign-in, forced first-login password change, session
  start (project + required description + screenshot override), and the active
  recording view with a stop button. Issues commands to the worker; renders state.
- `src/content/recorder.ts` (in-page): runs rrweb (source of truth) with masking
  on by default, resolves selectors for the flag hotkey, batches events to the
  worker.

## Identity (task 3.2)

Sign-in uses the backend's own REST endpoints (`POST /auth/login`), not a
client SDK, because the MV3 service worker has no DOM/window. Access and
refresh tokens live in `chrome.storage.local` (per-extension isolated). The
worker refreshes the access token via `POST /auth/refresh` when it is near
expiry. The stored refresh token is the user's identity and is treated as a
secret (design D27). The forced password-change flow calls the backend's
`/auth/complete-password-change`, which sets the new password hash and clears
the `mustChangePassword` marker in one call; capture is blocked server-side
until then.

## Capture (tasks 3.5, 3.6, 3.7)

- DOM-replay via rrweb with `maskAllInputs` plus per-project
  `maskTextSelector`/`blockSelector` from the project config.
- Optional viewport screenshots via `chrome.tabs.captureVisibleTab`, gated on the
  effective per-session screenshot setting (project default + override).
- Flag hotkey `Alt+Shift+F` (`chrome.commands` plus a content keydown fallback)
  posts the focused element's selector + replay offset to `POST /sessions/{id}/flags`.

## Upload

Events are batched, gzipped (`CompressionStream`), uploaded to a V4 signed PUT URL
from `GET /sessions/{id}/upload-urls`, then registered via
`POST /sessions/{id}/artifacts`. The extension never asserts tenant/uid; the server
stamps identity. Sessions end on the explicit stop button or a local inactivity
timer (server-side sweep is the backstop).

## Build

```
npm install        # from repo root (workspaces)
npm run build -w @qassistant/extension
```

Load `apps/extension/dist` as an unpacked extension. Configure via Vite env:
`VITE_API_BASE_URL` (the backend origin — defaults to the hosted VPS
`https://135-181-104-90.sslip.io`; set to `http://127.0.0.1:8080` for a local
backend) and `VITE_DEFAULT_TENANT_SLUG` (prefilled at sign-in; leave unset to
type it each time, or blank for super-admin).
