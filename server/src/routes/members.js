import { Router } from "express";
import { randomUUID } from "crypto";
import { db } from "../lib/firebase.js";
import {
  ValidationError,
  requireString,
  optionalString,
  validateSchedule,
  validateScheduleItem,
} from "../lib/validate.js";

// Mounted at /api/families/:familyId/members
export const membersRouter = Router({ mergeParams: true });

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

// GET /api/families/:familyId/members — list all members, ordered.
membersRouter.get("/", async (req, res, next) => {
  try {
    const familyRef = await getFamilyRef(req.params.familyId);
    const snap = await familyRef.collection("members").orderBy("order").get();
    const members = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    res.json({ members });
  } catch (err) {
    next(err);
  }
});

// POST /api/families/:familyId/members — create a new member.
// Fixes v1 bug: members are no longer limited to two hardcoded "kids" —
// any name is accepted, any number of members can be created.
membersRouter.post("/", async (req, res, next) => {
  try {
    const familyRef = await getFamilyRef(req.params.familyId);
    const name = requireString(req.body.name, "name", { maxLen: 100 });
    const emoji = optionalString(req.body.emoji, "emoji", { maxLen: 8 });

    // New members go to the end of the tab order.
    const existing = await familyRef.collection("members").get();
    const order = existing.size;

    const memberRef = familyRef.collection("members").doc();
    const memberDoc = {
      name,
      emoji,
      order,
      schedule: [],
      createdAt: new Date(),
    };
    await memberRef.set(memberDoc);
    res.status(201).json({ id: memberRef.id, ...memberDoc });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/families/:familyId/members/:memberId — rename / change emoji / reorder.
membersRouter.patch("/:memberId", async (req, res, next) => {
  try {
    const familyRef = await getFamilyRef(req.params.familyId);
    const memberRef = familyRef.collection("members").doc(req.params.memberId);
    const snap = await memberRef.get();
    if (!snap.exists) {
      return res.status(404).json({ error: "Member not found" });
    }

    const updates = {};
    if (req.body.name !== undefined) {
      updates.name = requireString(req.body.name, "name", { maxLen: 100 });
    }
    if (req.body.emoji !== undefined) {
      updates.emoji = optionalString(req.body.emoji, "emoji", { maxLen: 8 });
    }
    if (req.body.order !== undefined) {
      if (typeof req.body.order !== "number") {
        throw new ValidationError("order must be a number");
      }
      updates.order = req.body.order;
    }

    if (Object.keys(updates).length === 0) {
      throw new ValidationError("No valid fields provided to update");
    }

    await memberRef.update(updates);
    const updated = await memberRef.get();
    res.json({ id: updated.id, ...updated.data() });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/families/:familyId/members/:memberId — remove a member.
// Fixes v1 bug #4 (crash on deleting the active member): the frontend is
// responsible for re-selecting another member after this succeeds, but the
// backend now also tells it what's left, so the frontend never has to guess.
membersRouter.delete("/:memberId", async (req, res, next) => {
  try {
    const familyRef = await getFamilyRef(req.params.familyId);
    const memberRef = familyRef.collection("members").doc(req.params.memberId);
    const snap = await memberRef.get();
    if (!snap.exists) {
      return res.status(404).json({ error: "Member not found" });
    }

    await memberRef.delete();

    const remaining = await familyRef.collection("members").orderBy("order").get();
    res.json({
      deleted: true,
      remainingMembers: remaining.docs.map((d) => ({ id: d.id, ...d.data() })),
    });
  } catch (err) {
    next(err);
  }
});

// --- Schedule items (nested under a member) ---
// Schedule is stored as an embedded array on the member doc (see
// DATA_MODEL.md), so these endpoints read-modify-write that array rather
// than touching a separate collection. Firestore has no atomic
// "update one array element" op for arrays of objects, so we do the
// read-modify-write inside a transaction to avoid clobbering concurrent
// edits to *other* schedule items on the same member (e.g. two browser tabs
// editing different rows at once).

// PUT /api/families/:familyId/members/:memberId/schedule — replace the whole schedule.
// Used by the frontend after add/edit/delete/reorder, since the schedule is
// edited as a unit in the UI already (matches how v1 worked, just persisted
// server-side now instead of to localStorage).
membersRouter.put("/:memberId/schedule", async (req, res, next) => {
  try {
    const familyRef = await getFamilyRef(req.params.familyId);
    const memberRef = familyRef.collection("members").doc(req.params.memberId);
    const snap = await memberRef.get();
    if (!snap.exists) {
      return res.status(404).json({ error: "Member not found" });
    }

    const schedule = validateSchedule(req.body.schedule);
    await memberRef.update({ schedule });
    res.json({ id: memberRef.id, schedule });
  } catch (err) {
    next(err);
  }
});

// POST /api/families/:familyId/members/:memberId/schedule — add a single item.
// Transaction-guarded so two concurrent "add item" calls for the same
// member can't silently overwrite each other.
membersRouter.post("/:memberId/schedule", async (req, res, next) => {
  try {
    const familyRef = await getFamilyRef(req.params.familyId);
    const memberRef = familyRef.collection("members").doc(req.params.memberId);

    const newItem = validateScheduleItem(
      { ...req.body, id: req.body.id || randomUUID() },
      "new"
    );

    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(memberRef);
      if (!snap.exists) {
        const err = new ValidationError("Member not found");
        err.status = 404;
        throw err;
      }
      const schedule = Array.isArray(snap.data().schedule) ? snap.data().schedule : [];
      const updated = [...schedule, newItem];
      tx.update(memberRef, { schedule: updated });
      return updated;
    });

    res.status(201).json({ id: memberRef.id, schedule: result });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/families/:familyId/members/:memberId/schedule/:itemId
membersRouter.delete("/:memberId/schedule/:itemId", async (req, res, next) => {
  try {
    const familyRef = await getFamilyRef(req.params.familyId);
    const memberRef = familyRef.collection("members").doc(req.params.memberId);

    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(memberRef);
      if (!snap.exists) {
        const err = new ValidationError("Member not found");
        err.status = 404;
        throw err;
      }
      const schedule = Array.isArray(snap.data().schedule) ? snap.data().schedule : [];
      const updated = schedule.filter((item) => item.id !== req.params.itemId);
      tx.update(memberRef, { schedule: updated });
      return updated;
    });

    res.json({ id: memberRef.id, schedule: result });
  } catch (err) {
    next(err);
  }
});
