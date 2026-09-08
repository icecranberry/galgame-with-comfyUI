import assert from 'node:assert/strict'
/** Writes may fail while reads still return stale persisted values, including null. */
export function checkPendingStorage(t, save, load, command) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')
  let persisted = null, failWrite = false
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: {
    getItem: () => persisted,
    setItem(key, value) { if (failWrite) throw new Error('quota'); persisted = value },
    removeItem() { if (failWrite) throw new Error('storage blocked'); persisted = null },
  } })
  t.after(() => { failWrite = false; save(null); if (original) Object.defineProperty(globalThis, 'sessionStorage', original); else delete globalThis.sessionStorage })
  failWrite = true; save(command); assert.deepEqual(load(), command)
  failWrite = false; save(command)
  const newer = { ...command, body: { ...command.body, idempotencyKey: 'newer-key' } }
  failWrite = true; save(newer); assert.deepEqual(load(), newer)
  // Failed removal must not resurrect the old persisted operation.
  save(null); assert.equal(load(), null)
  // Successful clearing restores ordinary reads, including an authoritative null.
  failWrite = false; save(null); assert.equal(persisted, null); assert.equal(load(), null)
  persisted = JSON.stringify(command); assert.deepEqual(load(), command)
  persisted = null; assert.equal(load(), null)
}
