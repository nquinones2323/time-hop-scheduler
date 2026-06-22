# Going Live — Step by Step

This turns the code into a real, working app on your phone. I've pre-built
everything that doesn't require your personal accounts. The steps below are
the unavoidable ones — things that need your Google account, your GitHub
account, or your phone, which I have no way to do for you.

**Three things need to exist, in this order:**
1. A Firestore database (Google's, free tier) — where the data lives
2. A backend server on Render (free tier) — talks to Firestore, serves the API
3. The frontend on GitHub Pages (free) — what you and your family open on your phones

Budget about 20–30 minutes the first time. After today, updating the app is
just re-uploading files — no repeat of these steps.

---

## Step 1 — Create the Firestore database (~5 min)

1. Go to **console.firebase.google.com** and sign in with any Google account.
2. Click **Add project**. Name it anything (e.g. "family-clock"). You can
   decline Google Analytics when asked — not needed.
3. Once created, in the left sidebar: **Build → Firestore Database →
   Create database**. Choose **production mode**, pick any region close to
   you, click **Enable**.
4. Left sidebar gear icon → **Project settings → Service accounts** tab →
   **Generate new private key**. This downloads a `.json` file.
   **Keep this file private — it's a password, not something to share or
   post anywhere.** Save it somewhere you'll find it in Step 2.
5. Still in Project Settings, copy your **Project ID** (shown near the top) —
   you'll want it in a moment.

You don't need to touch `firestore.rules` manually — Step 2 deploys it for
you automatically as part of connecting the database... actually, simplest
path: skip manual rule deployment entirely for now. Firestore in production
mode defaults to deny-all, which would block the app. To open it to the
app's traffic without needing the Firebase CLI:

5b. In Firestore Database, click the **Rules** tab. Delete what's there and
    paste in the contents of this project's `firestore.rules` file
    (open it, copy everything, paste it into that box), then click **Publish**.

---

## Step 2 — Deploy the backend to Render (~10 min)

Render deploys from a GitHub repo, so first the code needs to be on GitHub.

1. Go to **github.com**, sign in (or create a free account).
2. Click the **+** in the top right → **New repository**. Name it
   `family-clock` (or anything), keep it **Private** if you'd rather, click
   **Create repository**.
3. On the new repo's page, click **uploading an existing file** (or
   **Add file → Upload files**). Drag in *everything* from the project
   folder I gave you — the whole thing, `server/`, `public/`, all of it —
   and commit.
4. Go to **render.com**, sign in with your GitHub account (this lets Render
   see your repos).
5. Click **New → Web Service**, pick the `family-clock` repo you just
   created. Render should auto-detect the settings from `render.yaml`
   already in the project (root directory `server`, build command
   `npm install`, start command `npm start`) — if it asks you to confirm,
   accept the defaults.
6. Before clicking deploy, scroll to **Environment Variables** and add one:
   - Key: `FIREBASE_SERVICE_ACCOUNT_JSON`
   - Value: open the `.json` file you downloaded in Step 1, copy its
     *entire contents*, and paste it in as the value (all one block, that's fine)
7. Click **Create Web Service**. Wait for the deploy to finish (a few
   minutes) — Render will show a URL like
   `https://family-clock-api-xxxx.onrender.com`. **Copy this URL.**
8. Test it: visit `<that URL>/api/health` in your browser. You should see
   `{"ok":true}`. If you see an error instead, see Troubleshooting below.

**Note on the free tier:** Render's free web services spin down after 15
minutes of no traffic and take ~30–60 seconds to wake back up on the next
request. The first alert check after idle time might be slightly delayed.
Fine for a family trip app; if it ever bothers you, Render's paid tier
removes this.

---

## Step 3 — Point the frontend at your backend (~2 min)

1. In the project files (the same ones you uploaded to GitHub), open
   `public/config.js` in any text editor.
2. Replace the placeholder URL with your real Render URL from Step 2,
   keeping `/api` at the end:
   ```js
   window.FAMILY_CLOCK_API_BASE = "https://family-clock-api-xxxx.onrender.com/api";
   ```
3. Save, and re-upload just this one changed file to the same GitHub repo
   (drag it into the repo page again, GitHub will offer to replace the
   existing file).

---

## Step 4 — Put the frontend on GitHub Pages (~5 min)

1. In your `family-clock` GitHub repo, go to **Settings → Pages**.
2. Under **Build and deployment → Source**, choose **Deploy from a branch**.
3. Branch: `main`, folder: **`/public`** (not root — the app's files live in
   the `public` subfolder). Click **Save**.
4. Wait a minute, then refresh the page — GitHub shows you the live URL,
   something like `https://yourusername.github.io/family-clock/`.
5. Open that URL. You should see the app — the navy "departures board"
   screen with an empty state prompting you to add a family member.

---

## Step 5 — Install it on your phone (~2 min, same as v1)

- **iPhone**: open the GitHub Pages URL in **Safari** (must be Safari, not
  Chrome). Tap the Share icon → **Add to Home Screen**.
- **Android**: open the URL in **Chrome**. Tap the **⋮** menu → **Add to
  Home Screen** (or Chrome may prompt you automatically).

Open it from the home screen icon from now on, not the browser tab.

---

## Step 6 — Enable push notifications (~5 min)

This is the part that makes alerts arrive even when the app is closed or
your phone is locked. It needs one one-time setup step on the backend
before it'll work.

1. On your own computer, open a terminal in the project folder, then:
   ```bash
   cd server
   npm install
   node generate-vapid-keys.js
   ```
   This prints two long strings: `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`.
   **Generate these once and never regenerate them** — changing them later
   breaks every phone that already enabled notifications, and they'd all
   need to re-enable.

2. On Render (your backend service from Step 2): go to **Environment**,
   add two more variables:
   - `VAPID_PUBLIC_KEY` → paste the public key
   - `VAPID_PRIVATE_KEY` → paste the private key
   - `VAPID_SUBJECT` → `mailto:` followed by an email address you control
     (e.g. `mailto:you@example.com`). This is required — Apple's push
     service specifically rejects requests with a missing or malformed
     subject.

   Render will redeploy automatically when you save these.

3. In `public/config.js`, paste the **public** key only (never the private
   one — this file is downloaded by every visitor's browser) into the line
   that currently says `PASTE_YOUR_VAPID_PUBLIC_KEY_HERE`. Re-upload that
   file to GitHub like you did in Step 3.

4. Open the app from your phone's home screen icon (not a browser tab —
   on iPhone this step genuinely doesn't work from a regular Safari tab,
   only from the installed icon). Scroll to the **Push notifications**
   card near the bottom and tap **Enable**. Your phone will show its
   normal "Allow notifications?" prompt — allow it.

5. To confirm it's actually working end to end (recommended — this is the
   one thing in this whole setup that's genuinely hard to verify just by
   looking at the screen), send yourself a test push:
   ```bash
   curl -X POST https://your-render-url.onrender.com/api/families/YOUR_FAMILY_ID/push-subscriptions/test
   ```
   You can find `YOUR_FAMILY_ID` in your browser's dev tools → Application
   → Local Storage → `family-clock-family-id`. You should get a real
   notification on your phone within a few seconds, even with the app
   closed.

### What to expect, honestly

- **Android**: works reliably, in-browser or installed, no special steps
  beyond the above.
- **iPhone**: works on iOS 16.4 and later, but *only* for the installed
  home-screen icon — never in a regular Safari tab. If you're in the
  **European Union**, Apple currently disables this entirely due to a
  regulatory requirement on their end — PWAs open as plain Safari tabs
  with no push support, and there's no workaround on my end for that;
  it's an iOS/EU restriction, not something this app can route around.
- Apple's documentation also describes push subscriptions occasionally
  going stale after a week or two of the app sitting unused, sometimes
  requiring the person to reopen the app once to silently refresh it.
  If notifications mysteriously stop after a quiet stretch, opening the
  app once usually fixes it.
- The free Render tier sleeps after 15 minutes idle. The cron job that
  checks schedules runs *inside* that same sleeping server, so during a
  sleep window, scheduled pushes won't fire until something wakes it back
  up. For a small family app this is a real but minor tradeoff; Render's
  paid "always-on" tier removes it if it ever matters.

---

## Sharing with your partner / both phones seeing the same data

Right now, "family" identity is a random ID generated the first time the
app loads on a device (see `DATA_MODEL.md` for why — there's no login
system yet). That means **your phone and your partner's phone will each
create a separate family** unless you do one manual step:

1. On your phone, open the browser's developer tools is not realistic on
   mobile — instead, the simplest path today: open the app in a *desktop*
   browser once (same GitHub Pages URL), open dev tools (F12) → Application/
   Storage tab → Local Storage → find the key `family-clock-family-id` →
   copy its value.
2. On your partner's phone, you'd need to manually set that same value in
   their browser's local storage before first load — which isn't practical
   without a developer tool on mobile.

**Honest answer: multi-device sync for one family isn't truly usable yet
without a login system.** This was flagged as a known gap in the last
handoff (see `README.md`'s "No auth" section) — it's real follow-up work,
not a quick fix. If this matters to you soon, say so and I'll build a
simple "enter a family code to join" screen, which is a much smaller lift
than full login and would solve exactly this.

---

## Troubleshooting

- **`/api/health` shows an error on Render**: check the Render service's
  **Logs** tab. Most likely cause: the `FIREBASE_SERVICE_ACCOUNT_JSON`
  env var wasn't pasted correctly (it must be the *entire* JSON file
  contents, including the outer `{ }`).
- **App loads but shows "Couldn't load your data"**: open your browser's
  dev tools console (F12) and look for the actual error — usually either
  a CORS issue (the backend's `CORS_ORIGIN` env var on Render needs to
  match your GitHub Pages URL exactly, or be left unset/`*` for now) or a
  Firestore rules issue (double check Step 1.5b was published).
- **Changes you make to schedule items don't seem to save**: check the
  small status line under the footer in the app — it says "Couldn't save"
  with a reason if a write fails, rather than failing silently.
- **"Enable" button does nothing, or notifications never arrive**: on
  iPhone, confirm you opened the app from the **home screen icon**, not a
  Safari tab — the push card will tell you this directly if it detects
  you're not in installed mode. Otherwise, check the push card's status
  text for the actual error after tapping Enable — it shows the real
  browser-reported reason rather than a generic failure.
- **Test push (`/push-subscriptions/test`) returns an error mentioning
  VAPID keys**: Step 6.2 wasn't completed, or Render hasn't finished
  redeploying since you added the env vars yet — check the Render Logs tab.
- **Test push says "sent: 0" but no error**: nobody's tapped Enable on any
  device yet for that family, so there's nothing registered to push to.
