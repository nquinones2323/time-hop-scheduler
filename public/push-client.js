// Push notification enrollment flow. Kept as its own module since it's a
// distinct concern from the rest of app.js's state/rendering — this file
// only deals with "does this device have a working push subscription, and
// how do we get or remove one."

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

// Three possible states the UI needs to distinguish, since the right thing
// to show a parent is different in each case:
//   "unsupported"  — this browser/OS combination can't do push at all
//                     (e.g. iOS Safari NOT installed as a home-screen app yet)
//   "subscribed"   — already enrolled on this device
//   "not-subscribed" — supported, not yet enrolled; show an enable button
export async function getPushStatus() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    return "unsupported";
  }
  // iOS Safari specifically only exposes PushManager when running as an
  // installed home-screen app, not in a regular browser tab — this check
  // catches that case naturally since PushManager won't exist there either,
  // but we also check standalone display mode for a clearer message (see
  // app.js's use of this).
  try {
    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    return existing ? "subscribed" : "not-subscribed";
  } catch {
    return "unsupported";
  }
}

export function isRunningAsInstalledApp() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

// Must be called from inside a user gesture (e.g. a button click) — both
// iOS and Android require this for the permission prompt to appear at all.
export async function subscribeToPush(vapidPublicKey) {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error(
      permission === "denied"
        ? "Notifications are blocked for this app. Enable them in your phone's Settings to use this feature."
        : "Notification permission wasn't granted."
    );
  }

  const reg = await navigator.serviceWorker.ready;
  const subscription = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
  });

  const json = subscription.toJSON();
  return {
    endpoint: json.endpoint,
    keys: json.keys,
    userAgent: navigator.userAgent,
  };
}

export async function unsubscribeFromPush() {
  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  if (!existing) return null;
  const endpoint = existing.endpoint;
  await existing.unsubscribe();
  return endpoint;
}
