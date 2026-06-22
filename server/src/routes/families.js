import { Router } from "express";
import { randomUUID } from "crypto";
import { db } from "../lib/firebase.js";
import {
  ValidationError,
  requireTimeZone,
} from "../lib/validate.js";

export const familyRouter = Router();

// POST /api/families — create a new family, returns its id.
// The client generates nothing; the server owns ID generation so IDs are
// guaranteed unique and unguessable-enough (random UUID v4).
familyRouter.post("/", async (req, res, next) => {
  try {
    const homeTz =
      typeof req.body.homeTz === "string" && req.body.homeTz
        ? requireTimeZone(req.body.homeTz, "homeTz")
        : Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Chicago";
    const destTz =
      typeof req.body.destTz === "string" && req.body.destTz
        ? requireTimeZone(req.body.destTz, "destTz")
        : "Europe/London";

    const familyId = randomUUID();
    const familyDoc = {
      homeTz,
      destTz,
      activeTripId: null,
      soundOn: true,
      createdAt: new Date(),
    };
    await db.collection("families").doc(familyId).set(familyDoc);
    res.status(201).json({ familyId, ...familyDoc });
  } catch (err) {
    next(err);
  }
});

// GET /api/families/:familyId — fetch a family doc.
familyRouter.get("/:familyId", async (req, res, next) => {
  try {
    const snap = await db.collection("families").doc(req.params.familyId).get();
    if (!snap.exists) {
      return res.status(404).json({ error: "Family not found" });
    }
    res.json({ familyId: snap.id, ...snap.data() });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/families/:familyId — update homeTz / destTz / soundOn / activeTripId.
// Partial update: only fields present in the body are touched.
familyRouter.patch("/:familyId", async (req, res, next) => {
  try {
    const ref = db.collection("families").doc(req.params.familyId);
    const snap = await ref.get();
    if (!snap.exists) {
      return res.status(404).json({ error: "Family not found" });
    }

    const updates = {};
    if (req.body.homeTz !== undefined) {
      updates.homeTz = requireTimeZone(req.body.homeTz, "homeTz");
    }
    if (req.body.destTz !== undefined) {
      updates.destTz = requireTimeZone(req.body.destTz, "destTz");
    }
    if (req.body.soundOn !== undefined) {
      if (typeof req.body.soundOn !== "boolean") {
        throw new ValidationError("soundOn must be a boolean");
      }
      updates.soundOn = req.body.soundOn;
    }
    if (req.body.activeTripId !== undefined) {
      // null is valid (clears the active trip); otherwise must be a string
      // referencing a real trip doc, which we verify here so the family
      // doc can never point at a deleted/nonexistent trip.
      if (req.body.activeTripId !== null) {
        if (typeof req.body.activeTripId !== "string") {
          throw new ValidationError("activeTripId must be a string or null");
        }
        const tripSnap = await ref.collection("trips").doc(req.body.activeTripId).get();
        if (!tripSnap.exists) {
          throw new ValidationError("activeTripId does not reference an existing trip");
        }
      }
      updates.activeTripId = req.body.activeTripId;
    }

    if (Object.keys(updates).length === 0) {
      throw new ValidationError("No valid fields provided to update");
    }

    await ref.update(updates);
    const updated = await ref.get();
    res.json({ familyId: updated.id, ...updated.data() });
  } catch (err) {
    next(err);
  }
});

// One-time migration endpoint: a v1 client with localStorage data calls this
// once on first load (when it has old data but no familyId yet) to create a
// family pre-populated with its existing kids/schedule instead of starting
// empty. See DATA_MODEL.md "Migration note from v1".
familyRouter.post("/import", async (req, res, next) => {
  try {
    const { homeTz, destTz, soundOn, kids } = req.body;
    if (!Array.isArray(kids)) {
      throw new ValidationError("kids must be an array");
    }

    const familyId = randomUUID();
    const familyRef = db.collection("families").doc(familyId);
    const batch = db.batch();

    batch.set(familyRef, {
      homeTz: homeTz ? requireTimeZone(homeTz, "homeTz") : "America/Chicago",
      destTz: destTz ? requireTimeZone(destTz, "destTz") : "Europe/London",
      activeTripId: null,
      soundOn: typeof soundOn === "boolean" ? soundOn : true,
      createdAt: new Date(),
    });

    kids.forEach((kid, index) => {
      if (!kid || typeof kid.name !== "string" || !kid.name.trim()) return; // skip malformed entries rather than failing the whole import
      const memberRef = familyRef.collection("members").doc();
      const schedule = Array.isArray(kid.schedule)
        ? kid.schedule
            .filter((item) => item && typeof item.label === "string" && typeof item.time === "string")
            .map((item) => ({
              id: typeof item.id === "string" ? item.id : randomUUID(),
              label: item.label.trim().slice(0, 100) || "Untitled",
              time: item.time,
              emoji: null,
              notes: null,
            }))
        : [];
      batch.set(memberRef, {
        name: kid.name.trim().slice(0, 100),
        emoji: null,
        order: index,
        schedule,
        createdAt: new Date(),
      });
    });

    await batch.commit();
    const familySnap = await familyRef.get();
    res.status(201).json({ familyId, ...familySnap.data() });
  } catch (err) {
    next(err);
  }
});
