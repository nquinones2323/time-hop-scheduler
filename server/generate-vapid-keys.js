// Run this once: `node generate-vapid-keys.js`
// Prints a public/private VAPID keypair. These identify YOUR server to the
// push services (Apple's, Google's) — generate them once, then put the
// values in your environment variables (see GOING_LIVE.md Step 6) and
// never regenerate them, since changing them would invalidate every
// existing push subscription (every installed phone would need to
// re-subscribe).

import webpush from "web-push";

const keys = webpush.generateVAPIDKeys();

console.log("\nVAPID keys generated. Save these — you'll need both:\n");
console.log("VAPID_PUBLIC_KEY=" + keys.publicKey);
console.log("VAPID_PRIVATE_KEY=" + keys.privateKey);
console.log("\nThe public key also needs to go into public/config.js on the frontend.");
console.log("The private key is a secret — set it as an env var on Render, never commit it.\n");
