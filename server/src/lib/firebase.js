import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import "dotenv/config";

// Initialization supports two paths, in order of preference:
//
// 1. GOOGLE_APPLICATION_CREDENTIALS env var pointing at a service-account
//    JSON file on disk (standard Google Cloud convention). Works great for
//    local dev and most hosts (Render, Railway, etc).
// 2. FIREBASE_SERVICE_ACCOUNT_JSON env var containing the service account
//    JSON *as a string* (useful when your host only gives you env vars, no
//    file storage — e.g. some serverless platforms).
//
// If neither is set, this throws early and loudly rather than silently
// failing on the first Firestore call, which is a much more confusing place
// to discover a missing credential.
//
// TEST_MODE escape hatch: when FAMILY_CLOCK_TEST_MODE=1, this exports an
// in-memory fake instead of touching real Firebase at all, so route logic
// can be exercised with real HTTP calls in environments with no path to
// Google's services (see test/fake-firestore.js for what it does and does
// not cover). This flag must never be set in any deployed environment —
// it provides zero persistence and zero security rules enforcement.

let db;

if (process.env.FAMILY_CLOCK_TEST_MODE === "1") {
  const { FakeFirestore } = await import("../../test/fake-firestore.js");
  db = new FakeFirestore();
} else {
  let app;
  if (!getApps().length) {
    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
      app = initializeApp({ credential: cert(serviceAccount) });
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      // firebase-admin will pick this up automatically via applicationDefault(),
      // but we call initializeApp() explicitly so failures surface here.
      app = initializeApp();
    } else {
      throw new Error(
        "Missing Firebase credentials. Set either GOOGLE_APPLICATION_CREDENTIALS " +
        "(path to a service account JSON file) or FIREBASE_SERVICE_ACCOUNT_JSON " +
        "(the JSON contents as a string) before starting the server. " +
        "See server/README.md for how to generate this in the Firebase console."
      );
    }
  } else {
    app = getApps()[0];
  }
  db = getFirestore(app);
}

export { db };
