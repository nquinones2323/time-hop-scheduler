# Family Time Tracker — v2

Status: **Phase 1 (backend + data model + member CRUD) and Phase 3 (push
notifications) are built.** Phase 2 (trip-management UI) is partially
done — the backend trip routes exist and are tested, but there's no
"plan a trip" screen yet. Phase 4 (pre-trip gradual schedule shift) is not
started.

## Start here

- **Setting this up for the first time?** → `GOING_LIVE.md`. Walks through
  creating the Firebase project, deploying the backend to Render, hosting
  the frontend on GitHub Pages, installing on your phone, and enabling
  push notifications — in that order, with the unavoidable manual steps
  (the ones that need your accounts/phone) called out clearly.
- **Want to understand the data model?** → `DATA_MODEL.md`.
- **Want to understand how push notifications work?** → `PUSH_NOTIFICATIONS.md`.
- **Working on the backend specifically?** → `server/README.md`.

## What's in this folder

```
GOING_LIVE.md          — step-by-step deployment guide, start here
DATA_MODEL.md           — Firestore schema + design rationale
PUSH_NOTIFICATIONS.md   — push notification architecture + what was/wasn't tested
firestore.rules         — security rules (read the caveat at the top before deploying)
render.yaml              — Render deploy config (auto-detected when you connect the repo)
server/                  — Express + Firestore backend
  README.md              — backend setup, API reference, how to test
  generate-vapid-keys.js — one-time CLI for push notification keys
public/                  — the PWA frontend (no build step, same as v1)
  index.html              — preserved v1 visual design, extended structure
  config.js                — the one file you edit: backend URL + VAPID public key
  app.js                   — state, rendering, CRUD UI, alert engine, push UI
  app-core.js               — timezone math, safe-DOM helpers, sound
  push-client.js             — push permission/subscribe/unsubscribe logic
  api.js                      — backend API client
  manifest.json, sw.js, icon.svg — PWA shell + push notification handlers
```

## How this was tested

I don't have network access in this environment to Google's Firestore
emulator servers or to the real push delivery services
(`fcm.googleapis.com`, `web.push.apple.com`), so two things were verified
differently than "tested against the real thing end to end":

1. **Backend logic** (all CRUD, the scheduler's fire/dedup logic): tested
   against a small in-memory Firestore stand-in
   (`server/test/fake-firestore.js`, explicitly test-only) using real HTTP
   requests and direct function calls — not just read through and assumed
   correct. This double had two real gaps caught and fixed during this
   work (a missing `.ref` property and a missing `.empty` property,
   both matching real Firestore's actual API) — flagged here because a
   hand-rolled test double can silently hide bugs by failing to enforce
   the same contract as the real thing, which is worth being aware of
   before extending it further.
2. **Frontend**, including the push UI: driven with a real headless
   Chromium browser (Playwright) clicking buttons and reading back
   rendered DOM state, against the real running backend.
3. **Real push delivery to a real phone was never tested by me** — that
   genuinely requires a real deployed backend and a real device, which is
   why `GOING_LIVE.md` Step 6 ends with an explicit "send yourself a test
   push and confirm it lands" step rather than assuming it works.

See `PUSH_NOTIFICATIONS.md` for the detailed list of what was and wasn't
verified for the push system specifically.

## Bugs fixed from the v1 known-issues list (see original spec)

| # | Bug | Status |
|---|---|---|
| 1 | Unescaped `innerHTML` (XSS-adjacent) | Fixed — rewritten with safe DOM helpers, verified with an actual injection payload |
| 2 | No validation on duplicate times / blank labels | Fixed — duplicates flagged visually, blanks fall back to "Untitled" |
| 3 | Audio alerts may silently fail on iOS (gesture requirement) | Now moot for anyone using push notifications (Step 6) — the OS handles the alert sound itself. Still a real limitation in the no-push fallback path, where the page must stay open. |
| 4 | Crash risk deleting the active member | Fixed — backend returns remaining members, frontend never guesses |
| 5 | Midnight rollover ambiguity | Fixed — explicit "+1d"/"-1d" badge on destination date |
| 6 | No confirmation/undo on deleting a schedule item | Fixed — confirmation modal added |
| 7 | Inputs commit on blur only, feels unresponsive | Partially addressed — live duplicate-time highlighting on `input`, actual save still on `change` |
| 8 | Tab layout assumes exactly 2 members | Fixed — horizontal-scrolling tab row, scales to any count |
| 9 | Countdown timer not visually prominent | Fixed — increased size/weight in the alert banner |
| 10 | Borderline color contrast (amber-on-cream) | Not yet revisited |
| 11 | No "current trip" context | Partially addressed — UI distinguishes "no active trip" from "traveling"; full trip-planning UI still not built |

## Honest gaps / what's next

- **No trip-management UI.** Backend routes exist and are tested; no
  frontend screen to create/edit trips yet.
- **No auth, so no real multi-device sync for one family.** See
  `GOING_LIVE.md`'s "Sharing with your partner" section for the current
  manual workaround and why it's not a good long-term answer.
- **No pre-trip gradual schedule-shift feature.** Phase 4, not started.
- **Push notifications have known platform-level limitations that are
  Apple's/the platform's, not this app's** — EU iOS users currently can't
  use push at all (Apple's Digital Markets Act compliance change),
  subscriptions can go stale after inactivity, and Render's free tier
  sleeping affects delivery timing. All documented in `PUSH_NOTIFICATIONS.md`
  and `GOING_LIVE.md` Step 6, not hidden.
