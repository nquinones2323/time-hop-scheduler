// Minimal in-memory stand-in for the Firestore Admin SDK surface this app
// uses (collection/doc/get/set/update/delete/orderBy + a transaction with
// get/update, plus batch). This is NOT a full Firestore emulation — it
// exists purely so route logic (validation, status codes, control flow) can
// be exercised with real HTTP requests in this sandbox, which has no
// network path to Google's real Firestore emulator download
// (storage.googleapis.com is outside the allowed domains here). Tested
// against the actual Firebase emulator or a live project before relying on
// this in production — see server/README.md.

import { randomUUID } from "crypto";

function clone(obj) {
  return obj === undefined ? obj : JSON.parse(JSON.stringify(obj));
}

class FakeDocRef {
  constructor(store, path) {
    this.store = store;
    this.path = path;
    this.id = path.split("/").pop();
  }
  collection(name) {
    return new FakeCollectionRef(this.store, `${this.path}/${name}`);
  }
  async get() {
    const data = this.store.docs.get(this.path);
    return {
      exists: data !== undefined,
      id: this.id,
      data: () => clone(data),
    };
  }
  async set(data) {
    this.store.docs.set(this.path, clone(data));
  }
  async update(partial) {
    const existing = this.store.docs.get(this.path);
    if (existing === undefined) {
      throw new Error(`No document to update at ${this.path}`);
    }
    this.store.docs.set(this.path, { ...existing, ...clone(partial) });
  }
  async delete() {
    this.store.docs.delete(this.path);
  }
}

class FakeCollectionRef {
  constructor(store, path) {
    this.store = store;
    this.path = path;
    this._orderByField = null;
  }
  doc(id) {
    const docId = id || randomUUID();
    return new FakeDocRef(this.store, `${this.path}/${docId}`);
  }
  orderBy(field) {
    this._orderByField = field;
    return this;
  }
  async get() {
    const prefix = `${this.path}/`;
    const docs = [];
    for (const [path, data] of this.store.docs.entries()) {
      if (!path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length);
      if (rest.includes("/")) continue; // only direct children, not grandchildren
      const ref = new FakeDocRef(this.store, path);
      docs.push({ id: rest, ref, data: () => clone(data) });
    }
    if (this._orderByField) {
      docs.sort((a, b) => {
        const av = a.data()[this._orderByField];
        const bv = b.data()[this._orderByField];
        return av > bv ? 1 : av < bv ? -1 : 0;
      });
    }
    return { docs, size: docs.length, empty: docs.length === 0 };
  }
}

class FakeBatch {
  constructor(store) {
    this.store = store;
    this.ops = [];
  }
  set(ref, data) {
    this.ops.push(() => this.store.docs.set(ref.path, clone(data)));
  }
  update(ref, partial) {
    this.ops.push(() => {
      const existing = this.store.docs.get(ref.path);
      this.store.docs.set(ref.path, { ...existing, ...clone(partial) });
    });
  }
  delete(ref) {
    this.ops.push(() => this.store.docs.delete(ref.path));
  }
  async commit() {
    this.ops.forEach((op) => op());
  }
}

export class FakeFirestore {
  constructor() {
    this.docs = new Map(); // path -> data
  }
  collection(name) {
    return new FakeCollectionRef(this, name);
  }
  batch() {
    return new FakeBatch(this);
  }
  async runTransaction(fn) {
    // Simplified: no real isolation/retry, just runs the callback against
    // live refs. Good enough to test route logic; a real transaction's
    // conflict semantics are Firestore's to guarantee, not re-tested here.
    const tx = {
      get: (ref) => ref.get(),
      update: (ref, partial) => ref.update(partial),
      set: (ref, data) => ref.set(data),
      delete: (ref) => ref.delete(),
    };
    return fn(tx);
  }
}
