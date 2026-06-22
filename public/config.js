// EDIT THIS ONE LINE after you deploy the backend to Render.
// Render will give you a URL like https://family-clock-api.onrender.com
// Paste it below, keeping the /api at the end.
if (!window.FAMILY_CLOCK_API_BASE) {
  window.FAMILY_CLOCK_API_BASE = "https://family-clock-api.onrender.com/api";
}

// EDIT THIS after running `node generate-vapid-keys.js` on the server (see
// GOING_LIVE.md Step 6). This is the PUBLIC half only — never put the
// private key here, this file is downloaded by every visitor's browser.
if (!window.FAMILY_CLOCK_VAPID_PUBLIC_KEY) {
  window.FAMILY_CLOCK_VAPID_PUBLIC_KEY = "PASTE_YOUR_VAPID_PUBLIC_KEY_HERE";
}
