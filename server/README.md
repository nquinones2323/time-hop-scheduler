# Family Time Tracker — Backend (v2, phase 1)

This is the Express + Firestore backend for the Family Time Tracker app. It
replaces v1's `localStorage`-only persistence with a real backend, per the
project handoff spec. This phase covers: Firestore data model, family member
CRUD, schedule item CRUD, and trip CRUD. Push notifications (phase 3) and the
pre-trip schedule-shift feature (phase 4) are **not** built yet — this is
phase 1 only (backend + data model + member CRUD).

## What's here

```
server/
  src/
    index.js           — Express app entry point
    lib/firebase.js     — Firebase Admin SDK init
    lib/validate.js     — shared input validation
    routes/families.js  — family CRUD + v1 import endpoint
    routes/members.js   — member CRUD + nested schedule item CRUD
    routes/trips.js      — trip CRUD
  test/fake-firestore.js — in-memory Firestore double, TEST MODE ONLY
firestore.rules           — Firestore security rules
DATA_MODEL.md             — full schema + design rationale
```

## Setting up a real Firebase project (you need to do this)

I cannot create a Firebase project on your behalf — that requires your
Google account and the Firebase console. Steps:

1. Go to https://console.firebase.google.com and create a new project (any
   name, e.g. "family-clock").
2. In the project, go to **Build → Firestore Database → Create database**.
   Choose "production mode" (the security rules in `firestore.rules` will
   apply — start mode without rules is not safe to leave running).
3. Deploy the rules: install the Firebase CLI (`npm install -g
   firebase-tools`), run `firebase login`, then from this project's root run
   `firebase deploy --only firestore:rules` (you'll need to run `firebase
   init firestore` once first and point it at `firestore.rules`).
4. Generate a service account key: **Project settings → Service accounts →
   Generate new private key**. This downloads a JSON file — keep it secret,
   never commit it to git.
5. Set one of these environment variables for the server:
   - `GOOGLE_APPLICATION_CREDENTIALS=/path/to/your-key.json` (simplest for
     local dev — point it at the downloaded file), or
   - `FIREBASE_SERVICE_ACCOUNT_JSON='{...the file contents as one line...}'`
     (use this if your hosting platform only supports env vars, not file
     uploads — e.g. some serverless hosts)

## Running locally

```bash
cd server
npm install
cp .env.example .env   # then fill in your Firebase credential path
npm start
```

Server listens on port 3001 by default (override with `PORT`).

## Running the test suite without a real Firebase project

Set `FAMILY_CLOCK_TEST_MODE=1` and the server will use an in-memory fake
Firestore (`test/fake-firestore.js`) instead of connecting to Google at all.
**This flag must never be set in any real/deployed environment** — there is
zero persistence (data vanishes on restart) and zero security rule
enforcement. It exists only so route logic can be exercised with real HTTP
calls in this sandbox / in CI without needing live Firebase credentials.

This is NOT a substitute for testing against the real Firebase Emulator
Suite or a real (test) Firebase project before deploying. The fake
implements only the small subset of Firestore behavior these routes use; it
does not validate against `firestore.rules`, does not test Firestore's real
transaction/consistency guarantees, and does not catch Firestore-specific
quota or index errors. Before deploying:

```bash
firebase emulators:start --only firestore
# in another terminal, point the server at the emulator:
export FIRESTORE_EMULATOR_HOST=localhost:8080
npm start
```

## API summary

All routes are prefixed `/api`.

| Method | Path | Purpose |
|---|---|---|
| POST | `/families` | Create a new family |
| GET | `/families/:familyId` | Get family details |
| PATCH | `/families/:familyId` | Update homeTz/destTz/soundOn/activeTripId |
| POST | `/families/import` | One-time v1 localStorage → backend import |
| GET | `/families/:familyId/members` | List members |
| POST | `/families/:familyId/members` | Add a member |
| PATCH | `/families/:familyId/members/:id` | Rename/reorder a member |
| DELETE | `/families/:familyId/members/:id` | Remove a member |
| PUT | `/families/:familyId/members/:id/schedule` | Replace a member's whole schedule |
| POST | `/families/:familyId/members/:id/schedule` | Add one schedule item |
| DELETE | `/families/:familyId/members/:id/schedule/:itemId` | Remove one schedule item |
| GET | `/families/:familyId/trips` | List trips |
| POST | `/families/:familyId/trips` | Create a trip |
| PATCH | `/families/:familyId/trips/:id` | Edit a trip |
| DELETE | `/families/:familyId/trips/:id` | Delete a trip |
| POST | `/families/:familyId/push-subscriptions` | Register a device for push |
| DELETE | `/families/:familyId/push-subscriptions` | Unregister a device |
| POST | `/families/:familyId/push-subscriptions/test` | Send a real test push to every registered device |

See `DATA_MODEL.md` for the full schema and design rationale, including the
security-model caveat (no auth yet — read it before deploying anywhere
public).

## Known limitations of this phase

- **No auth.** Family identity is an opaque ID stored client-side. See the
  security note at the top of `firestore.rules`.
- **Push notifications are built** (see `PUSH_NOTIFICATIONS.md` at the
  project root) but require VAPID keys to be generated and configured —
  see `GOING_LIVE.md` Step 6. Without them, the app works fine, push
  simply won't fire.
- **No pre-trip schedule-shift feature yet.** Phase 4.
- Verified with a real HTTP client against an in-memory Firestore double,
  *not* against a live Firebase project. Before deploying, run through the
  Emulator Suite or a real test Firebase project at least once.
- Real push delivery to a real device was never tested by me — see
  `PUSH_NOTIFICATIONS.md` for exactly what was and wasn't verified.
