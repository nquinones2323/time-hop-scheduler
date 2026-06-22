import express from "express";
import cors from "cors";
import "dotenv/config";

import { familyRouter } from "./routes/families.js";
import { membersRouter } from "./routes/members.js";
import { tripsRouter } from "./routes/trips.js";
import { pushRouter } from "./routes/push.js";
import { ValidationError } from "./lib/validate.js";
import { startScheduleChecker } from "./lib/scheduler.js";

const app = express();

app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
app.use(express.json({ limit: "200kb" })); // generous for this payload size, small enough to block abuse

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.use("/api/families", familyRouter);
app.use("/api/families/:familyId/members", membersRouter);
app.use("/api/families/:familyId/trips", tripsRouter);
app.use("/api/families/:familyId/push-subscriptions", pushRouter);

// Centralized error handler. ValidationError carries its own status (400 by
// default, sometimes 404 when reused for "not found" inside route handlers);
// anything else is treated as an unexpected server error and logged, but
// never leaks internals (e.g. Firestore error text) to the client.
app.use((err, req, res, next) => {
  if (err instanceof ValidationError) {
    return res.status(err.status || 400).json({ error: err.message });
  }
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Family Clock API listening on port ${PORT}`);
  startScheduleChecker();
});
