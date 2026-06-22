import {
  resolveFamilyId, TIMEZONES, tzLabel, populateSelect, fmtTimeParts, fmtDate,
  getOffsetMinutes, getHomeNowParts, dateKeyFor, dayOffsetBetween, el, playChime,
  pickAlertEmoji, formatCountdown, api, ApiError,
} from "./app-core.js";
import { getPushStatus, isRunningAsInstalledApp, subscribeToPush, unsubscribeFromPush } from "./push-client.js";

/* ----------------------------------------------------------------------
 * State
 * -------------------------------------------------------------------- */
let familyId = null;
let family = null;       // { homeTz, destTz, soundOn, activeTripId }
let members = [];         // [{ id, name, emoji, order, schedule: [...] }]
let activeMemberId = null; // client-side only — which tab is open (see DATA_MODEL.md)

let firedToday = {};
let lastDateKey = "";
let activeAlerts = [];
let dismissedKeys = new Set();
const ALERT_DURATION_MS = 30 * 60 * 1000;

function activeMember() {
  return members.find(m => m.id === activeMemberId) || members[0] || null;
}

function setSyncStatus(text, isError = false) {
  const node = document.getElementById("sync-status");
  node.textContent = text;
  node.classList.toggle("error", isError);
}

// Wraps an API call: shows a transient "Saving…"/"Saved" status, and
// surfaces errors without ever silently swallowing a failed write (a
// "silent localStorage save" bug in v1's spirit — without this, a failed
// network write would look successful to the parent until they reload and
// find their edit gone).
async function withSync(label, fn) {
  setSyncStatus(label + "…");
  try {
    const result = await fn();
    setSyncStatus("Saved");
    setTimeout(() => setSyncStatus(""), 1500);
    return result;
  } catch (err) {
    const message = err instanceof ApiError ? err.message : "Connection problem";
    setSyncStatus(`Couldn't save — ${message}`, true);
    throw err;
  }
}

/* ----------------------------------------------------------------------
 * Rendering
 * -------------------------------------------------------------------- */
const homeSel = document.getElementById("home-tz");
const destSel = document.getElementById("dest-tz");

function renderTripStrip() {
  const strip = document.getElementById("trip-strip");
  const dot = document.getElementById("status-dot");
  const statusText = document.getElementById("status-text");
  strip.innerHTML = "";

  // Fixes v1 bug #11 (no "current trip" context): distinguishes "no active
  // trip" from "currently traveling to X" explicitly, instead of always
  // showing a destination as if a trip were underway.
  if (!family || !family.activeTripId) {
    dot.classList.add("no-trip");
    statusText.textContent = "No active trip";
    strip.appendChild(document.createTextNode("Add a trip to track travel countdown"));
    return;
  }

  dot.classList.remove("no-trip");
  statusText.textContent = "Traveling";
  // Active trip name is rendered via textContent below — never via
  // template-string innerHTML — per the XSS fix.
  if (family._activeTripName) {
    strip.appendChild(document.createTextNode("Current trip: "));
    const nameSpan = el("span", { className: "trip-name" }, family._activeTripName);
    strip.appendChild(nameSpan);
  } else {
    strip.appendChild(document.createTextNode("Trip in progress"));
  }
}

function renderTabs() {
  const tabsEl = document.getElementById("member-tabs");
  tabsEl.innerHTML = "";

  members.forEach(member => {
    const sub = el("span", { className: "tab-sub" }, `${member.schedule.length} scheduled`);
    const btn = el("button", {
      className: "tab-btn" + (member.id === activeMemberId ? " active" : ""),
      onClick: () => {
        activeMemberId = member.id;
        renderTabs();
        renderSchedule();
      },
    }, [member.emoji ? `${member.emoji} ${member.name}` : member.name, sub]);
    tabsEl.appendChild(btn);
  });

  const addBtn = el("button", {
    className: "tab-btn add-member-btn",
    "aria-label": "Add family member",
    onClick: openAddMemberModal,
  }, "+");
  tabsEl.appendChild(addBtn);

  const titleEl = document.getElementById("active-member-title");
  titleEl.innerHTML = "";
  const member = activeMember();
  if (member) {
    titleEl.appendChild(document.createTextNode(`${member.name}\u2019s schedule`));
    titleEl.appendChild(el("span", {}, "Times shown in home zone"));
  } else {
    titleEl.appendChild(document.createTextNode("No family members yet"));
    titleEl.appendChild(el("span", {}, "Add someone to start a schedule"));
  }

  document.getElementById("rename-member").disabled = !member;
  document.getElementById("remove-member").disabled = !member;
  document.getElementById("add-item").disabled = !member;
}

// Detect duplicate times within the same member's schedule (fixes part of
// v1 bug #2 — duplicate times allowed with no warning). We still allow it
// (a parent might genuinely want two things at once — e.g. "give medicine"
// and "snack" both at 3pm) but flag it visually rather than silently
// hiding the collision.
function findDuplicateTimeIds(schedule) {
  const byTime = new Map();
  schedule.forEach(item => {
    if (!byTime.has(item.time)) byTime.set(item.time, []);
    byTime.get(item.time).push(item.id);
  });
  const dupeIds = new Set();
  byTime.forEach(ids => { if (ids.length > 1) ids.forEach(id => dupeIds.add(id)); });
  return dupeIds;
}

function renderSchedule() {
  const list = document.getElementById("schedule-list");
  list.innerHTML = "";
  const member = activeMember();

  if (!member) {
    list.appendChild(el("div", { className: "empty-state" }, [
      "No family members yet.",
      document.createElement("br"),
      el("button", { className: "ghost-btn", onClick: openAddMemberModal }, "+ Add your first family member"),
    ]));
    return;
  }

  if (!member.schedule.length) {
    // textContent-based, so a member name containing special characters
    // can never break rendering (fixes v1 bug #1 for this specific spot).
    const empty = el("div", { className: "empty-state" });
    empty.appendChild(document.createTextNode(`No items yet — add the first one for ${member.name}.`));
    list.appendChild(empty);
    return;
  }

  const dupeIds = findDuplicateTimeIds(member.schedule);

  member.schedule
    .slice()
    .sort((a, b) => a.time.localeCompare(b.time))
    .forEach(item => {
      const row = el("div", { className: "ticket-row" });

      const labelInput = el("input", {
        type: "text",
        value: item.label,
        "aria-label": "Schedule item label",
      });
      labelInput.value = item.label; // set via property, not the value= attribute string, to avoid any encoding surprises
      labelInput.addEventListener("change", (e) => updateScheduleItem(member, item.id, { label: e.target.value }));

      const timeInput = el("input", {
        type: "time",
        value: item.time,
        className: dupeIds.has(item.id) ? "input-error" : "",
        "aria-label": "Schedule item time",
      });
      timeInput.addEventListener("change", (e) => updateScheduleItem(member, item.id, { time: e.target.value }));
      // Fixes v1 bug #7 (commit on blur only): live-update visual feedback
      // (e.g. dup-time highlighting) as the user types/picks, even though
      // the actual save still happens on change/blur to avoid hammering the
      // API on every keystroke.
      timeInput.addEventListener("input", () => {
        const wouldDupe = member.schedule.some(other => other.id !== item.id && other.time === timeInput.value);
        timeInput.classList.toggle("input-error", wouldDupe);
      });

      const delBtn = el("button", {
        className: "del-btn",
        "aria-label": "Delete item",
        onClick: () => confirmDeleteScheduleItem(member, item),
      }, "✕");

      row.appendChild(labelInput);
      row.appendChild(timeInput);
      row.appendChild(delBtn);
      list.appendChild(row);

      if (dupeIds.has(item.id)) {
        const warning = el("div", { className: "row-warning" }, `Same time as another item for ${member.name}`);
        list.appendChild(warning);
      }
    });
}

/* ----------------------------------------------------------------------
 * Schedule item mutations — call backend, then refresh local state.
 * Each one runs through withSync so a failed write is visible, not silent.
 * -------------------------------------------------------------------- */
async function updateScheduleItem(member, itemId, patch) {
  // Fixes v1 bug #2 (blank labels allowed silently): trim and fall back to
  // a placeholder rather than saving a blank — keeps the row from becoming
  // permanently unlabeled and confusing.
  if (patch.label !== undefined) {
    const trimmed = patch.label.trim();
    patch.label = trimmed || "Untitled";
  }
  const newSchedule = member.schedule.map(item => item.id === itemId ? { ...item, ...patch } : item);
  try {
    await withSync("Saving", () => api.replaceSchedule(familyId, member.id, newSchedule));
    member.schedule = newSchedule;
    renderTabs();
    renderSchedule();
  } catch {
    renderSchedule(); // re-render to revert any optimistic UI text back to last known-good state
  }
}

async function confirmDeleteScheduleItem(member, item) {
  // Fixes v1 bug #6 (no confirmation/undo on delete): a single misplaced
  // tap can no longer permanently remove an item without a chance to back out.
  const confirmed = await showConfirmModal({
    title: "Delete this item?",
    body: `“${item.label}” at ${item.time} will be removed from ${member.name}\u2019s schedule.`,
    confirmLabel: "Delete",
    danger: true,
  });
  if (!confirmed) return;

  try {
    const result = await withSync("Deleting", () => api.deleteScheduleItem(familyId, member.id, item.id));
    member.schedule = result.schedule;
    renderTabs();
    renderSchedule();
  } catch {
    // error already shown via sync status; state unchanged
  }
}

document.getElementById("add-item").addEventListener("click", async () => {
  const member = activeMember();
  if (!member) return;
  try {
    const result = await withSync("Adding", () => api.addScheduleItem(familyId, member.id, { label: "New item", time: "12:00" }));
    member.schedule = result.schedule;
    renderTabs();
    renderSchedule();
  } catch {
    // error shown via sync status
  }
});

/* ----------------------------------------------------------------------
 * Modal infrastructure (add member / rename / confirm delete)
 * All built with the `el()` safe-DOM helper — no innerHTML anywhere here,
 * so user-entered text can never be interpreted as markup.
 * -------------------------------------------------------------------- */
function closeModal() {
  document.getElementById("modal-root").innerHTML = "";
}

function showConfirmModal({ title, body, confirmLabel = "Confirm", danger = false }) {
  return new Promise((resolve) => {
    const root = document.getElementById("modal-root");
    const cleanup = (result) => { root.innerHTML = ""; resolve(result); };

    const backdrop = el("div", { className: "modal-backdrop", onClick: (e) => { if (e.target === backdrop) cleanup(false); } });
    const modal = el("div", { className: "modal" }, [
      el("h2", {}, title),
      el("p", { className: "modal-sub" }, body),
      el("div", { className: "modal-actions" }, [
        el("button", { className: "text-btn", onClick: () => cleanup(false) }, "Cancel"),
        el("button", { className: "primary-btn" + (danger ? " danger" : ""), onClick: () => cleanup(true) }, confirmLabel),
      ]),
    ]);
    backdrop.appendChild(modal);
    root.appendChild(backdrop);
  });
}

function openAddMemberModal() {
  const root = document.getElementById("modal-root");
  const backdrop = el("div", { className: "modal-backdrop", onClick: (e) => { if (e.target === backdrop) closeModal(); } });

  const nameInput = el("input", { type: "text", placeholder: "e.g. Aria", maxlength: "100" });
  const errorBox = el("div", { className: "error-text", style: "display:none;" });

  const submit = async () => {
    const name = nameInput.value.trim();
    if (!name) {
      errorBox.textContent = "Enter a name.";
      errorBox.style.display = "block";
      return;
    }
    try {
      const newMember = await withSync("Adding", () => api.createMember(familyId, { name }));
      members.push({ ...newMember, schedule: newMember.schedule || [] });
      activeMemberId = newMember.id;
      closeModal();
      renderTabs();
      renderSchedule();
    } catch (err) {
      errorBox.textContent = err instanceof ApiError ? err.message : "Something went wrong. Try again.";
      errorBox.style.display = "block";
    }
  };

  nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });

  const modal = el("div", { className: "modal" }, [
    el("h2", {}, "Add a family member"),
    el("p", { className: "modal-sub" }, "Anyone in the family — not just kids."),
    el("label", { className: "field-label" }, "Name"),
    nameInput,
    errorBox,
    el("div", { className: "modal-actions" }, [
      el("button", { className: "text-btn", onClick: closeModal }, "Cancel"),
      el("button", { className: "primary-btn", onClick: submit }, "Add"),
    ]),
  ]);
  backdrop.appendChild(modal);
  root.appendChild(backdrop);
  nameInput.focus();
}

function openRenameMemberModal(member) {
  const root = document.getElementById("modal-root");
  const backdrop = el("div", { className: "modal-backdrop", onClick: (e) => { if (e.target === backdrop) closeModal(); } });

  const nameInput = el("input", { type: "text", maxlength: "100" });
  nameInput.value = member.name;
  const errorBox = el("div", { className: "error-text", style: "display:none;" });

  const submit = async () => {
    const name = nameInput.value.trim();
    if (!name) {
      errorBox.textContent = "Name can't be empty.";
      errorBox.style.display = "block";
      return;
    }
    try {
      await withSync("Saving", () => api.updateMember(familyId, member.id, { name }));
      member.name = name;
      closeModal();
      renderTabs();
      renderSchedule();
    } catch (err) {
      errorBox.textContent = err instanceof ApiError ? err.message : "Something went wrong. Try again.";
      errorBox.style.display = "block";
    }
  };

  nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });

  const modal = el("div", { className: "modal" }, [
    el("h2", {}, "Rename family member"),
    el("label", { className: "field-label" }, "Name"),
    nameInput,
    errorBox,
    el("div", { className: "modal-actions" }, [
      el("button", { className: "text-btn", onClick: closeModal }, "Cancel"),
      el("button", { className: "primary-btn", onClick: submit }, "Save"),
    ]),
  ]);
  backdrop.appendChild(modal);
  root.appendChild(backdrop);
  nameInput.focus();
  nameInput.select();
}

document.getElementById("rename-member").addEventListener("click", () => {
  const member = activeMember();
  if (member) openRenameMemberModal(member);
});

// Fixes v1 bug #4 (crash on deleting the active member): the backend
// returns the remaining member list directly, so the frontend never has to
// guess what's left or risk pointing activeMemberId at a deleted id.
document.getElementById("remove-member").addEventListener("click", async () => {
  const member = activeMember();
  if (!member) return;

  const confirmed = await showConfirmModal({
    title: "Remove this family member?",
    body: `This deletes ${member.name}\u2019s entire schedule (${member.schedule.length} item${member.schedule.length === 1 ? "" : "s"}). This can't be undone.`,
    confirmLabel: "Remove",
    danger: true,
  });
  if (!confirmed) return;

  try {
    const result = await withSync("Removing", () => api.deleteMember(familyId, member.id));
    members = result.remainingMembers.map(m => ({ ...m, schedule: m.schedule || [] }));
    activeMemberId = members.length ? members[0].id : null;
    renderTabs();
    renderSchedule();
  } catch {
    // error shown via sync status
  }
});

/* ----------------------------------------------------------------------
 * Alerts
 * -------------------------------------------------------------------- */
function renderAlertStack(now) {
  const stack = document.getElementById("alert-stack");
  stack.innerHTML = "";
  activeAlerts.forEach(alert => {
    const msLeft = alert.expiresAt - now.getTime();
    // All alert text uses textContent/el(), so a member name or schedule
    // label containing markup-like characters can't break the banner.
    const banner = el("div", { className: "alert-banner" }, [
      el("span", { className: "alert-icon", "aria-hidden": "true" }, alert.emoji),
      el("div", { className: "alert-body" }, [
        el("strong", {}, alert.memberName),
        document.createTextNode(` — ${alert.label} time back home (${alert.triggerLabel})`),
        el("span", { className: "alert-countdown" }, formatCountdown(msLeft)),
      ]),
      el("button", { className: "dismiss-btn", "aria-label": "Dismiss alert", onClick: () => {
        dismissedKeys.add(alert.key);
        activeAlerts = activeAlerts.filter(a => a.key !== alert.key);
        renderAlertStack(new Date());
      }}, "✕"),
    ]);
    stack.appendChild(banner);
  });
}

function tick() {
  if (!family) return; // not loaded yet
  const now = new Date();
  const homeTz = homeSel.value;
  const destTz = destSel.value;

  const ht = fmtTimeParts(now, homeTz);
  const dt = fmtTimeParts(now, destTz);
  document.getElementById("home-time").firstChild.textContent = ht.time;
  document.getElementById("home-ampm").textContent = ht.ampm;
  document.getElementById("home-date").textContent = fmtDate(now, homeTz);

  document.getElementById("dest-time").firstChild.textContent = dt.time;
  document.getElementById("dest-ampm").textContent = dt.ampm;

  // Fixes v1 bug #5: shows a "+1 day" / "-1 day" badge when destination's
  // calendar date differs from home's, instead of leaving that ambiguous.
  const destDateEl = document.getElementById("dest-date");
  destDateEl.textContent = "";
  destDateEl.appendChild(document.createTextNode(fmtDate(now, destTz)));
  const offset = dayOffsetBetween(homeTz, destTz, now);
  if (offset !== 0) {
    const badge = el("span", { className: "day-offset" }, offset > 0 ? `+${offset}d` : `${offset}d`);
    destDateEl.appendChild(badge);
  }

  const homeOffset = getOffsetMinutes(homeTz, now);
  const destOffset = getOffsetMinutes(destTz, now);
  let diff = (destOffset - homeOffset) / 60;
  const diffAbs = Math.abs(diff);
  const diffStr = diff === 0 ? "Same time as home" :
    (diff > 0 ? "Destination is " + diffAbs.toFixed(diffAbs % 1 === 0 ? 0 : 1) + "h ahead of home" :
                "Destination is " + diffAbs.toFixed(diffAbs % 1 === 0 ? 0 : 1) + "h behind home");
  document.getElementById("diff-line").textContent = diffStr;

  const todayKey = dateKeyFor(homeTz, now);
  if (todayKey !== lastDateKey) {
    firedToday = {};
    dismissedKeys = new Set();
    lastDateKey = todayKey;
  }

  const homeHM = getHomeNowParts(homeTz, now);
  const soundOn = document.getElementById("sound-toggle").checked;

  members.forEach(member => {
    member.schedule.forEach(item => {
      const fireKey = member.id + "_" + item.id + "_" + todayKey;
      if (item.time === homeHM && !firedToday[fireKey]) {
        firedToday[fireKey] = true;
        if (!dismissedKeys.has(fireKey)) {
          activeAlerts.push({
            key: fireKey,
            memberName: member.name,
            label: item.label,
            emoji: pickAlertEmoji(item.label, item.emoji),
            triggerLabel: homeHM,
            triggeredAt: now.getTime(),
            expiresAt: now.getTime() + ALERT_DURATION_MS,
          });
        }
        if (soundOn) playChime();
      }
    });
  });

  activeAlerts = activeAlerts.filter(a => a.expiresAt > now.getTime());
  renderAlertStack(now);
}

/* ----------------------------------------------------------------------
 * Push notifications
 * -------------------------------------------------------------------- */
async function renderPushStatus() {
  const titleEl = document.getElementById("push-status-title");
  const subEl = document.getElementById("push-status-sub");
  const btn = document.getElementById("push-action-btn");
  subEl.classList.remove("warning", "error");

  if (!isRunningAsInstalledApp() && /iPhone|iPad|iPod/.test(navigator.userAgent)) {
    // iOS specifically requires installing as a home-screen app before
    // PushManager exists at all — this is the single most common reason
    // an iPhone user would see "Enable" do nothing, so it gets its own
    // message rather than the generic "unsupported" one.
    titleEl.textContent = "Push notifications";
    subEl.textContent = "On iPhone, add this to your Home Screen first (Share → Add to Home Screen), then open it from there to enable notifications.";
    subEl.classList.add("warning");
    btn.style.display = "none";
    return;
  }

  const status = await getPushStatus();
  btn.style.display = "inline-block";

  if (status === "unsupported") {
    titleEl.textContent = "Push notifications";
    subEl.textContent = "Not supported in this browser.";
    subEl.classList.add("warning");
    btn.style.display = "none";
  } else if (status === "subscribed") {
    titleEl.textContent = "Push notifications";
    subEl.textContent = "Enabled on this device.";
    btn.textContent = "Disable";
    btn.classList.add("subscribed");
  } else {
    titleEl.textContent = "Push notifications";
    subEl.textContent = "Get alerts even when the app is closed.";
    btn.textContent = "Enable";
    btn.classList.remove("subscribed");
  }
}

document.getElementById("push-action-btn").addEventListener("click", async () => {
  const btn = document.getElementById("push-action-btn");
  const subEl = document.getElementById("push-status-sub");
  const status = await getPushStatus();

  if (status === "subscribed") {
    try {
      const endpoint = await unsubscribeFromPush();
      if (endpoint) await api.unregisterPushSubscription(familyId, endpoint);
      await renderPushStatus(); // success path: safe to show the normal "not enabled" state
    } catch (err) {
      // Error path returns early WITHOUT calling renderPushStatus(), which
      // would otherwise immediately overwrite this message with the
      // generic status text — a real bug caught in testing, not
      // theoretical: the error literally never reached the screen before
      // this fix.
      subEl.textContent = "Couldn't disable — try again.";
      subEl.classList.add("error");
    }
    return;
  }

  const vapidKey = window.FAMILY_CLOCK_VAPID_PUBLIC_KEY;
  if (!vapidKey || vapidKey === "PASTE_YOUR_VAPID_PUBLIC_KEY_HERE") {
    subEl.textContent = "Push isn't configured on the server yet.";
    subEl.classList.add("error");
    return;
  }

  btn.disabled = true;
  try {
    const subscription = await subscribeToPush(vapidKey);
    await api.registerPushSubscription(familyId, subscription);
    btn.disabled = false;
    await renderPushStatus(); // success path only
  } catch (err) {
    btn.disabled = false;
    subEl.textContent = err.message || "Couldn't enable notifications.";
    subEl.classList.add("error");
  }
});

/* ----------------------------------------------------------------------
 * Boot
 * -------------------------------------------------------------------- */
async function main() {
  // Register the service worker and wait for it BEFORE doing anything that
  // depends on it (push status check needs navigator.serviceWorker.ready
  // to actually resolve, which requires registration to have already
  // happened — registering only inside a later "load" listener, as v1/early
  // v2 did, raced this).
  if ("serviceWorker" in navigator) {
    try {
      await navigator.serviceWorker.register("sw.js");
    } catch {
      // Offline caching and push just won't work; the rest of the app
      // (talking to the live backend) still functions fine without it.
    }
  }

  try {
    familyId = await resolveFamilyId();
  } catch (err) {
    setSyncStatus("Couldn't connect — check your network and reload", true);
    return;
  }

  try {
    const [familyData, memberData] = await Promise.all([
      api.getFamily(familyId),
      api.listMembers(familyId),
    ]);
    family = familyData;
    members = memberData.members.map(m => ({ ...m, schedule: m.schedule || [] }));
    activeMemberId = members.length ? members[0].id : null;
  } catch (err) {
    setSyncStatus("Couldn't load your data — check your network and reload", true);
    return;
  }

  populateSelect(homeSel, family.homeTz);
  populateSelect(destSel, family.destTz);
  document.getElementById("sound-toggle").checked = family.soundOn !== false;

  homeSel.addEventListener("change", async () => {
    tick();
    try { await withSync("Saving", () => api.updateFamily(familyId, { homeTz: homeSel.value })); }
    catch { /* status already shown */ }
  });
  destSel.addEventListener("change", async () => {
    tick();
    try { await withSync("Saving", () => api.updateFamily(familyId, { destTz: destSel.value })); }
    catch { /* status already shown */ }
  });
  document.getElementById("sound-toggle").addEventListener("change", async (e) => {
    try { await withSync("Saving", () => api.updateFamily(familyId, { soundOn: e.target.checked })); }
    catch { /* status already shown */ }
  });
  document.getElementById("test-sound").addEventListener("click", playChime);

  renderTripStrip();
  renderTabs();
  renderSchedule();
  renderPushStatus();
  tick();
  setInterval(tick, 1000);
}

main();
