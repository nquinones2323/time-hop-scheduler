import { Router } from "express";
import { db } from "../lib/firebase.js";
import { sendPush, isPushConfigured } from "../lib/push.js";
import { ValidationError, requireString } from "../lib/validate.js";

// Mounted at /api/families/:familyId/push-subscriptions
export const pushRouter = Router({ mergeParams: true });

async function getFamilyRef(familyId) {
  const ref = db.collection("families").doc(familyId);
  const snap = await ref.get();
  if (!snap.exists) {
    const err = new ValidationError("Family not found");
    err.status = 404;
    throw err;
  }
  return ref;
}

function validateSubscriptionShape(body) {
  if (typeof body.endpoint !== "string" || !body.endpoint) {
    throw new ValidationError("endpoint is required");
  }
  if (!body.keys || typeof body.keys.p256dh !== "string" || typeof body.keys.auth !== "string") {
    throw new ValidationError("keys.p256dh and keys.auth are required");
  }
  return {
    endpoint: body.endpoint,
    keys: { p256dh: body.keys.p256dh, auth: body.keys.auth },
    userAgent: typeof body.userAgent === "string" ? body.userAgent.slice(0, 300) : null,
  };
}

// POST /api/families/:familyId/push-subscriptions — register a device.
// Per the spec's open question about multiple parents' phones getting the
// same alerts: this is intentionally many-subscriptions-per-family, not
// one. Each device that enables notifications adds its own subscription;
// all of them get pushed to when a schedule item fires.
//
// Keyed by endpoint (not a random ID) so re-subscribing the same browser/
// device (e.g. after the subscription is refreshed by the browser) updates
// the existing record instead of creating a duplicate that would double-fire
// alerts on that device.
pushRouter.post("/", async (req, res, next) => {
  try {
    const familyRef = await getFamilyRef(req.params.familyId);
    const sub = validateSubscriptionShape(req.body);

    // Firestore doc IDs can't contain "/", which endpoints always have
    // (they're full URLs) — hash it to a safe doc ID instead of trying to
    // sanitize the URL itself.
    const docId = await hashEndpoint(sub.endpoint);
    await familyRef.collection("pushSubscriptions").doc(docId).set({
      ...sub,
      createdAt: new Date(),
    });

    res.status(201).json({ registered: true });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/families/:familyId/push-subscriptions — unregister a device
// (called when the user turns notifications off in the app, or when the
// browser reports the subscription as no longer valid).
pushRouter.delete("/", async (req, res, next) => {
  try {
    const familyRef = await getFamilyRef(req.params.familyId);
    const endpoint = requireString(req.body.endpoint, "endpoint", { maxLen: 2000 });
    const docId = await hashEndpoint(endpoint);
    await familyRef.collection("pushSubscriptions").doc(docId).delete();
    res.json({ unregistered: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/families/:familyId/push-subscriptions/test — sends a real push
// to every registered device for this family right now. Exists so a parent
// can verify "did push actually arrive on my lock screen" without waiting
// for a real scheduled item to fire — this is the single hardest thing to
// debug blind, so a one-tap test path matters.
pushRouter.post("/test", async (req, res, next) => {
  try {
    const familyRef = await getFamilyRef(req.params.familyId);

    if (!isPushConfigured()) {
      throw new ValidationError(
        "Push notifications aren't configured on the server yet (missing VAPID keys). See GOING_LIVE.md Step 6."
      );
    }

    const snap = await familyRef.collection("pushSubscriptions").get();
    if (snap.empty) {
      throw new ValidationError("No devices are registered for push yet on this family.");
    }

    const results = await Promise.all(
      snap.docs.map(async (doc) => {
        const result = await sendPush(doc.data(), {
          title: "Test alert ✈️",
          body: "If you see this, push notifications are working.",
          tag: "test",
        });
        if (result.expired) {
          await doc.ref.delete(); // clean up dead subscriptions opportunistically
        }
        return { ...result, endpoint: doc.data().endpoint };
      })
    );

    res.json({ sent: results.filter((r) => r.ok).length, total: results.length, results });
  } catch (err) {
    next(err);
  }
});

async function hashEndpoint(endpoint) {
  const { createHash } = await import("crypto");
  return createHash("sha256").update(endpoint).digest("hex").slice(0, 64);
}
