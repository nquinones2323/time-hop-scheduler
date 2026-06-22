// Lightweight hand-rolled validation. No schema library dependency needed
// for a surface this small; if the API grows much beyond this, consider
// zod.

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/; // HH:MM, 24h
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/; // YYYY-MM-DD

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ValidationError";
    this.status = 400;
  }
}

export function requireString(value, fieldName, { maxLen = 200, allowEmpty = false } = {}) {
  if (typeof value !== "string") {
    throw new ValidationError(`${fieldName} must be a string`);
  }
  const trimmed = value.trim();
  if (!allowEmpty && trimmed.length === 0) {
    throw new ValidationError(`${fieldName} cannot be empty`);
  }
  if (trimmed.length > maxLen) {
    throw new ValidationError(`${fieldName} must be ${maxLen} characters or fewer`);
  }
  return trimmed;
}

export function requireTimeZone(value, fieldName) {
  const tz = requireString(value, fieldName, { maxLen: 100 });
  try {
    // Throws RangeError if the IANA zone name is invalid.
    Intl.DateTimeFormat(undefined, { timeZone: tz });
  } catch {
    throw new ValidationError(`${fieldName} is not a valid IANA time zone`);
  }
  return tz;
}

export function requireTime(value, fieldName) {
  if (typeof value !== "string" || !TIME_RE.test(value)) {
    throw new ValidationError(`${fieldName} must be in HH:MM 24-hour format`);
  }
  return value;
}

export function requireDate(value, fieldName) {
  if (typeof value !== "string" || !DATE_RE.test(value)) {
    throw new ValidationError(`${fieldName} must be in YYYY-MM-DD format`);
  }
  return value;
}

export function optionalString(value, fieldName, opts = {}) {
  if (value === undefined || value === null || value === "") return null;
  return requireString(value, fieldName, opts);
}

// Validates a single schedule item shape. Used both when creating an item
// and when validating items inside a full schedule array.
//
// lastFiredDate is server-managed push-dedup state (see DATA_MODEL.md) —
// the frontend never sends it, but if it's already present on an existing
// item (e.g. the cron job set it, then the user edits the item's time
// through the normal UI), it must be preserved here rather than silently
// dropped, or every schedule edit would reset push dedup for that item.
export function validateScheduleItem(item, index) {
  if (typeof item !== "object" || item === null) {
    throw new ValidationError(`Schedule item ${index} must be an object`);
  }
  const result = {
    id: requireString(item.id, `Schedule item ${index} id`, { maxLen: 100 }),
    label: requireString(item.label, `Schedule item ${index} label`, { maxLen: 100 }),
    time: requireTime(item.time, `Schedule item ${index} time`),
    emoji: optionalString(item.emoji, `Schedule item ${index} emoji`, { maxLen: 8 }),
    notes: optionalString(item.notes, `Schedule item ${index} notes`, { maxLen: 500 }),
  };
  if (typeof item.lastFiredDate === "string" && DATE_RE.test(item.lastFiredDate)) {
    result.lastFiredDate = item.lastFiredDate;
  } else {
    result.lastFiredDate = null;
  }
  return result;
}

export function validateSchedule(schedule) {
  if (!Array.isArray(schedule)) {
    throw new ValidationError("schedule must be an array");
  }
  const items = schedule.map((item, i) => validateScheduleItem(item, i));
  const ids = items.map((i) => i.id);
  if (new Set(ids).size !== ids.length) {
    throw new ValidationError("schedule item ids must be unique within a member");
  }
  return items;
}
