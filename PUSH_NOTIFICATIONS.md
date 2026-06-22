# Push Notifications — Implementation Notes (Phase 3)

This is the architectural shift the original spec called out explicitly:
moving alert-firing from "JavaScript checks the clock while the page is
open" to "a server checks every family's schedule every minute and pushes
to registered devices, even when the app is closed or the phone is locked."

For setup steps, see `GOING_LIVE.md` Step 6 — this file is the *how it
works* and *why it's built this way* reference, for whoever maintains this
next.

## Architecture

Standard **Web Push** (VAPID-based), not Firebase Cloud Messaging's
proprietary SDK, despite the project using Firestore for everything else.

**Why not FCM's JS SDK**, given the spec leaned Firebase: iOS Safari's push
implementation is the standards-based Web Push API, not FCM — using FCM's
SDK would add a dependency that doesn't help on iOS and ties the frontend
unnecessarily tightly to Google's stack for no real benefit. The `web-push`
npm package speaks the same standard protocol to both Apple's push service
(`web.push.apple.com`) and Google's (`fcm.googleapis.com`) — my server code
never needs to know or care which one a given subscription belongs to; it
sends to whatever `endpoint` the browser handed back.

```
Browser (PushManager.subscribe)
  → subscription { endpoint, keys: { p256dh, auth } }
  → POST to backend, stored in Firestore (families/{id}/pushSubscriptions)

Server (node-cron, every minute)
  → reads every family's homeTz + every member's schedule
  → for each item where item.time === now-in-homeTz AND not already fired today
      → sends a Web Push payload to every subscription for that family
      → marks the item's lastFiredDate so it won't re-fire today

Browser's service worker (sw.js)
  → "push" event → self.registration.showNotification(...)
  → "notificationclick" event → focuses or opens the app
```

## Files involved

| File | Role |
|---|---|
| `server/generate-vapid-keys.js` | One-time CLI to generate the server's VAPID keypair |
| `server/src/lib/push.js` | Wraps `web-push`'s `sendNotification`; distinguishes permanently-dead subscriptions (404/410) from transient failures |
| `server/src/lib/scheduler.js` | The cron job — `checkAllSchedulesOnce()` is exported specifically so it can be tested directly without waiting for a real per-minute tick |
| `server/src/routes/push.js` | Subscribe/unsubscribe/test-push HTTP routes |
| `public/push-client.js` | Browser-side: permission request, `pushManager.subscribe()`, status detection |
| `public/sw.js` | The `push` and `notificationclick` event handlers that actually show the OS notification |
| `public/index.html` / `app.js` | The "Push notifications" settings card UI |

## Dedup design: why `lastFiredDate` lives on the schedule item itself

The obvious naive approach — an in-memory "already fired today" set on the
server — breaks the moment the server restarts (Render's free tier does
this routinely on deploys and after idle periods): everything would
either re-fire immediately on restart, or (if the set defaulted to "assume
already fired") silently miss real alerts for the rest of that day.

Storing `lastFiredDate` directly on each schedule item in Firestore makes
the check durable across restarts, at the cost of a small additional write
on every fire (acceptable — these are infrequent, human-paced events, not
high-frequency data). The field is intentionally excluded from anything
the frontend's schedule-editing UI displays or sends on its own — see the
comment in `server/src/lib/validate.js`'s `validateScheduleItem` for how
the field survives a normal user edit (e.g. changing a time) without being
silently wiped, which was a real bug caught during testing, not a
hypothetical one.

## Duplication between scheduler.js and the frontend's tick()

`server/src/lib/scheduler.js` re-implements a few small pieces of logic
that also exist in `public/app-core.js` (`pickAlertEmoji`, time/date
formatting helpers). This is a deliberate, accepted duplication, not an
oversight: the frontend has no build step (per the original spec's design
constraint — "no build step, no dependencies"), and the backend is a
separate Node process with no shared module resolution to the frontend's
files. Introducing a shared-code mechanism (a published package, a build
step, a symlink hack) would cost more in complexity than the ~15 lines of
duplicated logic justify. If `pickAlertEmoji`'s keyword list changes, it
needs to change in both places — flagged here so that's not a surprise.

## What was tested, and what genuinely could not be

This sandbox has no network path to `fcm.googleapis.com` or
`web.push.apple.com` (outside the allowed domains for this environment),
so **real push delivery to a real device was never tested end-to-end** by
me. What I could and did verify directly:

- `checkAllSchedulesOnce()` correctly identifies matching schedule items,
  correctly skips non-matching ones, correctly sets `lastFiredDate`, and
  correctly avoids re-firing the same item again within the same day —
  tested by directly invoking the function against a controlled in-memory
  Firestore double with a schedule item set to fire at the current minute
- A push subscription with deliberately-malformed keys is correctly
  rejected by the `web-push` library's own validation before any network
  call — confirms the failure-handling path executes
- The frontend's `subscribeToPush()` correctly calls the real, standard
  `pushManager.subscribe()` browser API with the right VAPID key encoding,
  and correctly surfaces the real browser-reported error when the actual
  network call to Google's push service fails (in this sandbox, that
  failure is the sandbox's own network restriction — `AbortError:
  Registration failed - push service not available` — which is exactly the
  same code path that would run if your phone's network blocked the same
  request, so the failure-handling behavior is genuinely verified even
  though the success path isn't)
- The settings card correctly detects and message differently for: not
  installed as a home-screen app on iOS, unsupported browser, subscribed,
  and not-yet-subscribed states
- An end-to-end regression pass (member CRUD, schedule CRUD) after adding
  all of the above confirms nothing broke

**What requires a real phone and a real deployed backend**, which is why
`GOING_LIVE.md` Step 6 ends with "send yourself a test push and confirm it
arrives" as an explicit, separate verification step rather than assuming
it works:
- Whether a push actually arrives on a real lock screen
- Whether Apple's APNs-backed delivery behaves as documented (including
  the documented occasional subscription staleness after inactivity)
- Real-world latency between a schedule item's time and the push landing
- Render's free-tier sleep/wake cycle's actual effect on delivery timing
