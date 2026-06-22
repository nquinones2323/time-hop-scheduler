// Thin fetch wrapper around the backend API. No framework, matches v1's
// vanilla-JS approach — this app has no build step by design (see spec:
// "no build step, no dependencies").

const API_BASE = window.FAMILY_CLOCK_API_BASE || "http://localhost:3001/api";

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    // non-JSON response body; body stays null
  }
  if (!res.ok) {
    throw new ApiError(body && body.error ? body.error : `Request failed (${res.status})`, res.status);
  }
  return body;
}

export const api = {
  // Families
  createFamily: (data) => request("/families", { method: "POST", body: JSON.stringify(data) }),
  getFamily: (familyId) => request(`/families/${familyId}`),
  updateFamily: (familyId, data) =>
    request(`/families/${familyId}`, { method: "PATCH", body: JSON.stringify(data) }),
  importLegacyFamily: (data) =>
    request("/families/import", { method: "POST", body: JSON.stringify(data) }),

  // Members
  listMembers: (familyId) => request(`/families/${familyId}/members`),
  createMember: (familyId, data) =>
    request(`/families/${familyId}/members`, { method: "POST", body: JSON.stringify(data) }),
  updateMember: (familyId, memberId, data) =>
    request(`/families/${familyId}/members/${memberId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  deleteMember: (familyId, memberId) =>
    request(`/families/${familyId}/members/${memberId}`, { method: "DELETE" }),

  // Schedule items
  replaceSchedule: (familyId, memberId, schedule) =>
    request(`/families/${familyId}/members/${memberId}/schedule`, {
      method: "PUT",
      body: JSON.stringify({ schedule }),
    }),
  addScheduleItem: (familyId, memberId, item) =>
    request(`/families/${familyId}/members/${memberId}/schedule`, {
      method: "POST",
      body: JSON.stringify(item),
    }),
  deleteScheduleItem: (familyId, memberId, itemId) =>
    request(`/families/${familyId}/members/${memberId}/schedule/${itemId}`, {
      method: "DELETE",
    }),

  // Trips
  listTrips: (familyId) => request(`/families/${familyId}/trips`),
  createTrip: (familyId, data) =>
    request(`/families/${familyId}/trips`, { method: "POST", body: JSON.stringify(data) }),
  updateTrip: (familyId, tripId, data) =>
    request(`/families/${familyId}/trips/${tripId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  deleteTrip: (familyId, tripId) =>
    request(`/families/${familyId}/trips/${tripId}`, { method: "DELETE" }),

  // Push notifications
  registerPushSubscription: (familyId, subscription) =>
    request(`/families/${familyId}/push-subscriptions`, {
      method: "POST",
      body: JSON.stringify(subscription),
    }),
  unregisterPushSubscription: (familyId, endpoint) =>
    request(`/families/${familyId}/push-subscriptions`, {
      method: "DELETE",
      body: JSON.stringify({ endpoint }),
    }),
  sendTestPush: (familyId) =>
    request(`/families/${familyId}/push-subscriptions/test`, { method: "POST" }),
};

export { ApiError };
