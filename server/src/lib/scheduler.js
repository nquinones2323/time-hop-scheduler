import cron from "node-cron";
import { db } from "./firebase.js";
import { sendPush, isPushConfigured } from "./push.js";

// Mirrors the emoji-picking logic in public/app-core.js's pickAlertEmoji.
// Kept as a separate copy rather than a shared import because the server
// and frontend are genuinely separate runtimes here (no bundler, no shared
// module resolution) — see PUSH_NOTIFICATIONS.md (project root) for why this
// duplication is an accepted tradeoff rather than an oversight.
function pickAlertEmoji(label, explicitEmoji) {
  if (explicitEmoji) return explicitEmoji;
  const l = label.toLowerCase();
  if (l.includes("breakfast")) return "🥞";
  if (l.includes("lunch")) return "🥪";
  if (l.includes("dinner")) return "🍽️";
  if (l.includes("snack")) return "🍎";
  if (l.includes("nap")) return "😴";
  if (l.includes("bed")) return "🌙";
  if (l.includes("med")) return "💊";
  return "⏰";
}

function getHomeNowParts(tz, date) {
  const dtf = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour12: false, hour: "2-digit", minute: "2-digit" });
  const parts = dtf.formatToParts(date).reduce((a, p) => { a[p.type] = p.value; return a; }, {});
  return parts.hour + ":" + parts.minute;
}
function dateKeyFor(tz, date) {
  // Must match the YYYY-MM-DD format validate.js's DATE_RE expects for
  // lastFiredDate (this is a server-side value, unlike the frontend's own
  // dateKeyFor in app-core.js, which uses locale-default MM/DD/YYYY purely
  // for internal same-string comparison and never sends it to the backend).
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date).reduce((a, p) => { a[p.type] = p.value; return a; }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

// Runs once per minute. For every family, every member, every schedule
// item: if the item's time matches "now" in that family's home timezone,
// and it hasn't already fired today (tracked via lastFiredDate, stored on
// the item itself so a server restart doesn't cause a double-fire or a
// missed day), push to every registered device for that family.
//
// This intentionally does NOT replicate the 30-minute-visible /
// dismissible alert-banner behavior — that's a client-side UI concept.
// A push notification is a single fire-and-forget event; the phone's own
// notification center handles "still showing until dismissed," which is
// arguably a *better* fit for that requirement than anything this server
// needs to manage.
export function startScheduleChecker() {
  if (!isPushConfigured()) {
    console.warn(
      "[scheduler] VAPID keys not set — push notifications are disabled. " +
      "The schedule checker will still run (harmless) but won't send anything. " +
      "See GOING_LIVE.md Step 6."
    );
  }

  cron.schedule("* * * * *", async () => {
    try {
      await checkAllSchedulesOnce();
    } catch (err) {
      // A single bad family/member shouldn't crash the whole checker for
      // everyone else — checkAllSchedulesOnce already isolates per-family
      // errors internally, so reaching this catch means something more
      // fundamental (e.g. Firestore unreachable) and is worth logging loudly.
      console.error("[scheduler] Unexpected top-level error:", err);
    }
  });

  console.log("[scheduler] Schedule checker started (runs every minute).");
}

export async function checkAllSchedulesOnce() {
  const familiesSnap = await db.collection("families").get();
  const now = new Date();

  await Promise.all(
    familiesSnap.docs.map(async (familyDoc) => {
      try {
        await checkOneFamily(familyDoc, now);
      } catch (err) {
        console.error(`[scheduler] Error checking family ${familyDoc.id}:`, err.message);
      }
    })
  );
}

async function checkOneFamily(familyDoc, now) {
  const family = familyDoc.data();
  const homeTz = family.homeTz;
  if (!homeTz) return; // family doc not fully set up yet

  const homeHM = getHomeNowParts(homeTz, now);
  const todayKey = dateKeyFor(homeTz, now);

  const membersSnap = await familyDoc.ref.collection("members").get();
  const itemsToFire = []; // { memberRef, memberName, item }

  membersSnap.docs.forEach((memberDoc) => {
    const member = memberDoc.data();
    const schedule = Array.isArray(member.schedule) ? member.schedule : [];
    schedule.forEach((item) => {
      if (item.time === homeHM && item.lastFiredDate !== todayKey) {
        itemsToFire.push({ memberRef: memberDoc.ref, memberName: member.name, item });
      }
    });
  });

  if (itemsToFire.length === 0) return;

  // Mark all matching items as fired BEFORE sending push, not after.
  // If push sending fails partway through (network blip, one dead
  // subscription), we still don't want to re-fire the same item next
  // minute — better to occasionally miss a push on a transient error than
  // to spam a family with the same "breakfast" alert every minute until
  // someone notices. Each member doc is updated independently so one
  // member's write failing doesn't block another's.
  await Promise.all(
    [...new Set(itemsToFire.map((f) => f.memberRef.path))].map(async (path) => {
      const group = itemsToFire.filter((f) => f.memberRef.path === path);
      const memberRef = group[0].memberRef;
      const snap = await memberRef.get();
      const schedule = Array.isArray(snap.data().schedule) ? snap.data().schedule : [];
      const firingIds = new Set(group.map((f) => f.item.id));
      const updated = schedule.map((item) =>
        firingIds.has(item.id) ? { ...item, lastFiredDate: todayKey } : item
      );
      await memberRef.update({ schedule: updated });
    })
  );

  const subsSnap = await familyDoc.ref.collection("pushSubscriptions").get();
  if (subsSnap.empty) return; // nobody registered for push on this family yet

  await Promise.all(
    itemsToFire.flatMap(({ memberName, item }) =>
      subsSnap.docs.map(async (subDoc) => {
        const result = await sendPush(subDoc.data(), {
          title: `${memberName} — ${item.label}`,
          body: `It's ${item.time} back home.`,
          tag: `${memberName}-${item.id}-${todayKey}`,
          emoji: pickAlertEmoji(item.label, item.emoji),
        });
        if (result.expired) {
          await subDoc.ref.delete();
        } else if (!result.ok) {
          console.error(`[scheduler] Push failed for family ${familyDoc.id}:`, result.error);
        }
      })
    )
  );
}
