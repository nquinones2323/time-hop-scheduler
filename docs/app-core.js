import { api, ApiError } from "./api.js";

/* ----------------------------------------------------------------------
 * Family identity (no auth in this phase — see DATA_MODEL.md)
 * -------------------------------------------------------------------- */
const FAMILY_ID_KEY = "family-clock-family-id";
const LEGACY_STORAGE_KEY = "family-clock-state-v2"; // v1's localStorage key

async function resolveFamilyId() {
  const existing = localStorage.getItem(FAMILY_ID_KEY);
  if (existing) return existing;

  // First load on this device. Check for a v1 localStorage blob to migrate
  // forward (see DATA_MODEL.md "Migration note from v1") rather than
  // silently discarding a returning user's data.
  let legacy = null;
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (raw) legacy = JSON.parse(raw);
  } catch {
    // malformed legacy blob; ignore and fall through to a fresh family
  }

  let result;
  if (legacy && Array.isArray(legacy.kids) && legacy.kids.length) {
    result = await api.importLegacyFamily({
      homeTz: legacy.homeTz,
      destTz: legacy.destTz,
      soundOn: legacy.soundOn,
      kids: legacy.kids,
    });
  } else {
    result = await api.createFamily({});
  }
  localStorage.setItem(FAMILY_ID_KEY, result.familyId);
  return result.familyId;
}

/* ----------------------------------------------------------------------
 * Timezone helpers (unchanged from v1 — these were correct)
 * -------------------------------------------------------------------- */
const TIMEZONES = [
  "America/Los_Angeles","America/Denver","America/Chicago","America/New_York",
  "America/Anchorage","Pacific/Honolulu","America/Toronto","America/Mexico_City",
  "America/Sao_Paulo","Europe/London","Europe/Paris","Europe/Berlin","Europe/Madrid",
  "Europe/Rome","Europe/Moscow","Africa/Cairo","Africa/Johannesburg","Asia/Dubai",
  "Asia/Kolkata","Asia/Bangkok","Asia/Shanghai","Asia/Hong_Kong","Asia/Singapore",
  "Asia/Tokyo","Asia/Seoul","Australia/Sydney","Australia/Perth","Pacific/Auckland"
];

function tzLabel(tz) {
  return tz.split("/").pop().replace(/_/g, " ") + " (" + tz.split("/")[0] + ")";
}
function populateSelect(sel, defaultTz) {
  sel.innerHTML = "";
  TIMEZONES.forEach(tz => {
    const opt = document.createElement("option");
    opt.value = tz;
    opt.textContent = tzLabel(tz);
    if (tz === defaultTz) opt.selected = true;
    sel.appendChild(opt);
  });
}
function fmtTimeParts(date, tz) {
  const dtf = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: tz });
  const parts = dtf.formatToParts(date).reduce((a,p)=>{a[p.type]=(a[p.type]||"")+p.value; return a;},{});
  return { time: (parts.hour || "") + ":" + (parts.minute || ""), ampm: (parts.dayPeriod || "").toUpperCase() };
}
function fmtDate(date, tz) {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: tz }).format(date);
}
function getOffsetMinutes(tz, date) {
  const dtf = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour12: false, year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit" });
  const parts = dtf.formatToParts(date).reduce((a,p)=>{a[p.type]=p.value; return a;},{});
  const asUTC = Date.UTC(parts.year, parts.month-1, parts.day, parts.hour, parts.minute, parts.second);
  return (asUTC - date.getTime()) / 60000;
}
function getHomeNowParts(tz, date) {
  const dtf = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour12: false, hour:"2-digit", minute:"2-digit" });
  const parts = dtf.formatToParts(date).reduce((a,p)=>{a[p.type]=p.value; return a;},{});
  return parts.hour + ":" + parts.minute;
}
function dateKeyFor(tz, date) {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, year:"numeric",month:"2-digit",day:"2-digit" }).format(date);
}
// Fixes v1 bug #5 (midnight rollover ambiguity): returns -1, 0, or 1 for
// how many calendar days the destination date is offset from the home date,
// so the UI can show a "+1"/"-1" badge instead of leaving a tired parent to
// do that math at 2am.
function dayOffsetBetween(homeTz, destTz, date) {
  const homeKey = dateKeyFor(homeTz, date);
  const destKey = dateKeyFor(destTz, date);
  if (homeKey === destKey) return 0;
  // Compare by constructing both as UTC midnight-anchored dates is fragile
  // around DST; safer to just diff the actual offset-adjusted day count.
  const homeDate = new Date(homeKey + "T00:00:00Z");
  const destDate = new Date(destKey + "T00:00:00Z");
  const diffDays = Math.round((destDate.getTime() - homeDate.getTime()) / 86400000);
  return diffDays;
}

/* ----------------------------------------------------------------------
 * Safe DOM helpers — fixes v1 bug #1 (unescaped innerHTML / XSS-adjacent
 * risk). Anywhere user-entered text (member names, schedule labels, notes)
 * is displayed, it goes through textContent or these helpers, never string-
 * concatenated into innerHTML.
 * -------------------------------------------------------------------- */
function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(props).forEach(([key, value]) => {
    if (key === "className") node.className = value;
    else if (key === "dataset") Object.entries(value).forEach(([k, v]) => (node.dataset[k] = v));
    else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value !== null && value !== undefined) {
      node.setAttribute(key, value);
    }
  });
  (Array.isArray(children) ? children : [children]).forEach((child) => {
    if (child === null || child === undefined) return;
    node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  });
  return node;
}

/* ----------------------------------------------------------------------
 * Sound (unchanged from v1 — see comment in main() about the iOS gesture
 * limitation, which is flagged but not "fixable" client-side per the spec)
 * -------------------------------------------------------------------- */
let audioCtx = null;
function playChime() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
    const now = audioCtx.currentTime;
    [880, 1175].forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + i * 0.18);
      gain.gain.exponentialRampToValueAtTime(0.2, now + i * 0.18 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.18 + 0.35);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(now + i * 0.18);
      osc.stop(now + i * 0.18 + 0.4);
    });
  } catch (e) {}
}

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

function formatCountdown(msLeft) {
  const totalSec = Math.max(0, Math.round(msLeft / 1000));
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return mins + ":" + String(secs).padStart(2, "0") + " left on screen";
}

export { resolveFamilyId, TIMEZONES, tzLabel, populateSelect, fmtTimeParts, fmtDate,
  getOffsetMinutes, getHomeNowParts, dateKeyFor, dayOffsetBetween, el, playChime,
  pickAlertEmoji, formatCountdown, api, ApiError };
