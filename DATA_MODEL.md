# Firestore Data Model — Family Time Tracker v2

## Collection layout

```
families/{familyId}
  - createdAt: Timestamp
  - homeTz: string (IANA tz name)
  - destTz: string (IANA tz name)
  - activeTripId: string | null
  - soundOn: boolean

families/{familyId}/members/{memberId}
  - name: string
  - emoji: string | null         (optional avatar, e.g. "🧒")
  - order: number                (for stable tab ordering)
  - schedule: [
      {
        id: string,
        label: string,
        time: "HH:MM"            (24h, interpreted in home tz)
        emoji: string | null     (explicit override; else inferred from label)
        notes: string | null,
        lastFiredDate: "YYYY-MM-DD" | null
          (server-side push dedup only — see PUSH_NOTIFICATIONS.md. The
           client's own in-memory "firedToday" check is separate and
           unaffected by this; this field exists purely so the cron job
           survives a server restart without double-firing or missing a
           day. Not shown anywhere in the UI.)
      }
    ]
  - createdAt: Timestamp

families/{familyId}/trips/{tripId}
  - name: string | null          (e.g. "Grandma's house", optional)
  - homeTz: string
  - destTz: string
  - startDate: "YYYY-MM-DD"
  - endDate: "YYYY-MM-DD"
  - createdAt: Timestamp

families/{familyId}/pushSubscriptions/{subscriptionId}
  - endpoint: string
  - keys: { p256dh: string, auth: string }
  - createdAt: Timestamp
  - userAgent: string | null
  (Phase 3, push notifications — see PUSH_NOTIFICATIONS.md. One family can
   have many subscriptions, one per registered device, per the spec's open
   question about multiple parents' phones getting the same alerts —
   every device that taps "Enable" gets its own row here, and all of them
   are pushed to.)
```

## Why this shape

- **`schedule` embedded on the member doc, not a subcollection**: schedule
  lists are small (a handful of items per person) and always read/written
  together with the member. Embedding avoids extra round-trips and keeps
  the "add/edit/delete schedule item" operations atomic per member.
- **`members` and `trips` as subcollections, not embedded on `families`**:
  these grow and are queried independently (e.g. "list all trips," "get one
  member"), and subcollections let us avoid re-writing the whole family
  document for every small edit.
- **`activeTripId` as a pointer, not a boolean flag per trip**: avoids the
  classic "two trips both marked active" bug; there's exactly one source of
  truth for "what's the current trip."
- **No user/auth collection yet**: family identity is just an opaque
  `familyId` (UUID) stored in the client's `localStorage`, matching the
  "skip auth for now" decision. `firestore.rules` (see below) restricts
  reads/writes to documents matching a `familyId` the client already knows,
  which is the best we can do without real auth — this is explicitly a
  **soft boundary**, not real per-user security. Anyone who learns/guesses a
  family's ID can read or write its data. Acceptable for a prototype; flagged
  here so it isn't mistaken for real access control later when auth is added.

## Migration note from v1 (`localStorage`)

v1's shape was:
```js
{ homeTz, destTz, kids: [{ id, name, schedule: [{id, label, time}] }], activeKidId, soundOn }
```

This maps directly: `kids` → `members` subcollection, `activeKidId` → kept
client-side as UI state (not synced — see below), everything else 1:1. A
one-time client-side import path reads the old `localStorage` blob (if
present) and POSTs it into the new backend on first load, so existing v1
users don't lose their data when the app updates.

`activeKidId`/`activeMemberId` is **not** persisted to Firestore — it's
which tab is open, which is reasonably per-device, not per-family. It stays
in the frontend's local UI state.
