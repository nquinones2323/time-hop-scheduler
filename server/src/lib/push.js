import webpush from "web-push";
import "dotenv/config";

// VAPID identifies this server to the push services (Apple's web.push.apple.com,
// Google's fcm.googleapis.com) as the legitimate sender for subscriptions it
// holds. Generate these once with `node generate-vapid-keys.js` — see
// GOING_LIVE.md Step 6. Changing them later invalidates every existing
// subscription (every phone would need to re-enable notifications).
const PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
// VAPID requires a "subject" — a contact URL or mailto: link the push
// service can use to reach the sender if something's wrong. Apple's push
// service is documented to specifically reject malformed subjects (plain
// strings, missing scheme) with a 403, so this needs to be a real
// "mailto:" or "https://" URL, not a placeholder.
const SUBJECT = process.env.VAPID_SUBJECT || "mailto:admin@example.com";

let configured = false;
if (PUBLIC_KEY && PRIVATE_KEY) {
  webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY);
  configured = true;
}

export function isPushConfigured() {
  return configured;
}

/**
 * Sends a single push notification to one subscription.
 * Returns { ok: true } on success, or { ok: false, expired: boolean, error }
 * on failure. `expired: true` means the subscription is permanently dead
 * (uninstalled, permission revoked, or — per Apple's documented behavior —
 * just gone stale after a period of inactivity) and the caller should
 * delete it rather than retry.
 */
export async function sendPush(subscription, payload) {
  if (!configured) {
    return { ok: false, expired: false, error: "Push not configured (missing VAPID keys)" };
  }
  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: subscription.keys,
      },
      JSON.stringify(payload)
    );
    return { ok: true };
  } catch (err) {
    // 404/410 from the push service means the subscription is gone for
    // good (browser unsubscribed, app uninstalled, or — documented
    // specifically for iOS — gone stale after a period of inactivity).
    // Anything else (network blip, 5xx) is transient and shouldn't delete
    // a possibly-still-valid subscription.
    const expired = err.statusCode === 404 || err.statusCode === 410;
    return { ok: false, expired, error: err.message };
  }
}
