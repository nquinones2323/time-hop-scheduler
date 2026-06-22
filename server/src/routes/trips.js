import { Router } from "express";
import { db } from "../lib/firebase.js";
import {
  ValidationError,
  requireTimeZone,
  requireDate,
  optionalString,
} from "../lib/validate.js";

// Mounted at /api/families/:familyId/trips
export const tripsRouter = Router({ mergeParams: true });

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

function validateTripDates(startDate, endDate) {
  if (endDate < startDate) {
    throw new ValidationError("endDate cannot be before startDate");
  }
}

// GET /api/families/:familyId/trips — list all trips (past, current, future).
tripsRouter.get("/", async (req, res, next) => {
  try {
    const familyRef = await getFamilyRef(req.params.familyId);
    const snap = await familyRef.collection("trips").orderBy("startDate").get();
    res.json({ trips: snap.docs.map((d) => ({ id: d.id, ...d.data() })) });
  } catch (err) {
    next(err);
  }
});

// POST /api/families/:familyId/trips — create a trip.
// Does NOT automatically set it as the active trip — that's an explicit
// separate action (PATCH the family's activeTripId) so creating a future
// trip doesn't accidentally switch the app into "currently traveling" mode.
tripsRouter.post("/", async (req, res, next) => {
  try {
    const familyRef = await getFamilyRef(req.params.familyId);
    const homeTz = requireTimeZone(req.body.homeTz, "homeTz");
    const destTz = requireTimeZone(req.body.destTz, "destTz");
    const startDate = requireDate(req.body.startDate, "startDate");
    const endDate = requireDate(req.body.endDate, "endDate");
    validateTripDates(startDate, endDate);
    const name = optionalString(req.body.name, "name", { maxLen: 100 });

    const tripRef = familyRef.collection("trips").doc();
    const tripDoc = { name, homeTz, destTz, startDate, endDate, createdAt: new Date() };
    await tripRef.set(tripDoc);
    res.status(201).json({ id: tripRef.id, ...tripDoc });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/families/:familyId/trips/:tripId — edit a trip's details.
tripsRouter.patch("/:tripId", async (req, res, next) => {
  try {
    const familyRef = await getFamilyRef(req.params.familyId);
    const tripRef = familyRef.collection("trips").doc(req.params.tripId);
    const snap = await tripRef.get();
    if (!snap.exists) {
      return res.status(404).json({ error: "Trip not found" });
    }

    const current = snap.data();
    const updates = {};
    if (req.body.name !== undefined) {
      updates.name = optionalString(req.body.name, "name", { maxLen: 100 });
    }
    if (req.body.homeTz !== undefined) {
      updates.homeTz = requireTimeZone(req.body.homeTz, "homeTz");
    }
    if (req.body.destTz !== undefined) {
      updates.destTz = requireTimeZone(req.body.destTz, "destTz");
    }
    if (req.body.startDate !== undefined) {
      updates.startDate = requireDate(req.body.startDate, "startDate");
    }
    if (req.body.endDate !== undefined) {
      updates.endDate = requireDate(req.body.endDate, "endDate");
    }
    validateTripDates(
      updates.startDate ?? current.startDate,
      updates.endDate ?? current.endDate
    );

    if (Object.keys(updates).length === 0) {
      throw new ValidationError("No valid fields provided to update");
    }

    await tripRef.update(updates);
    const updated = await tripRef.get();
    res.json({ id: updated.id, ...updated.data() });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/families/:familyId/trips/:tripId
// If this trip was the active trip, clears the family's activeTripId so it
// never points at a deleted doc (the family PATCH route also independently
// guards against *setting* activeTripId to a nonexistent trip, but a trip
// that's deleted *after* being set active needs this separate cleanup).
tripsRouter.delete("/:tripId", async (req, res, next) => {
  try {
    const familyRef = await getFamilyRef(req.params.familyId);
    const tripRef = familyRef.collection("trips").doc(req.params.tripId);
    const snap = await tripRef.get();
    if (!snap.exists) {
      return res.status(404).json({ error: "Trip not found" });
    }

    const familySnap = await familyRef.get();
    const batch = db.batch();
    batch.delete(tripRef);
    if (familySnap.data().activeTripId === req.params.tripId) {
      batch.update(familyRef, { activeTripId: null });
    }
    await batch.commit();

    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});
