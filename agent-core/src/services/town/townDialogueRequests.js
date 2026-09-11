import { createHash, randomUUID } from 'node:crypto';

function reject(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function nonempty(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} must be a nonempty string`);
}

function scope({ worldId, epoch, npcId }) {
  nonempty(worldId, 'worldId');
  if (!Number.isSafeInteger(epoch) || epoch < 1) throw new TypeError('epoch must be a positive integer');
  if (!Number.isSafeInteger(npcId) || npcId < 1) throw new TypeError('npcId must be a positive integer');
}

function currentWorld(db, { worldId, epoch }) {
  const world = db.prepare('SELECT world_id, epoch FROM town_world_state WHERE singleton = 1').get();
  if (world?.world_id !== worldId || world.epoch !== epoch) reject('STALE_WORLD', 'Dialogue world/epoch is no longer current');
}

// JSON value only: sorted object keys make equivalent HTTP payloads hash identically.
// Reject lossy JSON coercions (undefined, non-finite numbers, sparse arrays, custom objects).
function canonicalJson(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (typeof value !== 'object' || seen.has(value)) throw new TypeError('Expected an acyclic JSON value');
  seen.add(value);
  let result;
  if (Array.isArray(value)) {
    const items = [];
    for (let i = 0; i < value.length; i++) items.push(canonicalJson(value[i], seen));
    result = `[${items.join(',')}]`;
  } else {
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
      throw new TypeError('Expected a plain JSON object');
    }
    result = `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key], seen)}`).join(',')}}`;
  }
  seen.delete(value);
  return result;
}

function response(row, started = false) {
  return { started, requestId: row.request_id, status: row.status,
    reply: row.reply_json === null ? null : JSON.parse(row.reply_json), error: row.error };
}

/**
 * Only started=true authorizes a new LLM call. Existing failed requests never retry.
 * The caller supplies every generation-relevant input in payload (e.g. message).
 * Request keys are scoped to (worldId, epoch, npcId, clientMessageId).
 * IMMEDIATE transaction + partial unique index also serialize separate connections.
 */
export function beginTownDialogueRequest(db, args) {
  scope(args);
  const { worldId, epoch, npcId, clientMessageId, payload } = args;
  nonempty(clientMessageId, 'clientMessageId');
  const hash = createHash('sha256').update(canonicalJson(payload)).digest('hex');
  return db.transaction(() => {
    currentWorld(db, args);
    const existing = db.prepare(`SELECT * FROM town_dialogue_requests
      WHERE world_id = ? AND world_epoch = ? AND npc_id = ? AND client_message_id = ?`)
      .get(worldId, epoch, npcId, clientMessageId);
    if (existing) {
      if (existing.payload_hash !== hash) reject('DIALOGUE_PAYLOAD_CONFLICT', 'clientMessageId was used with a different payload');
      return response(existing);
    }
    const busy = db.prepare(`SELECT request_id FROM town_dialogue_requests
      WHERE world_id = ? AND world_epoch = ? AND npc_id = ? AND status = 'processing'`).get(worldId, epoch, npcId);
    if (busy) reject('NPC_BUSY', 'NPC already has a processing dialogue request');
    const requestId = randomUUID();
    const now = Date.now();
    db.prepare(`INSERT INTO town_dialogue_requests
      (request_id, world_id, world_epoch, npc_id, client_message_id, payload_hash, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'processing', ?, ?)`).run(requestId, worldId, epoch, npcId, clientMessageId, hash, now, now);
    return response(db.prepare('SELECT * FROM town_dialogue_requests WHERE request_id = ?').get(requestId), true);
  }).immediate();
}

function settle(db, args, status, replyJson, error) {
  scope(args);
  nonempty(args.requestId, 'requestId');
  return db.transaction(() => {
    currentWorld(db, args);
    const row = db.prepare(`SELECT * FROM town_dialogue_requests
      WHERE request_id = ? AND world_id = ? AND world_epoch = ? AND npc_id = ?`)
      .get(args.requestId, args.worldId, args.epoch, args.npcId);
    if (!row) reject('DIALOGUE_REQUEST_NOT_FOUND', 'Dialogue request does not belong to this scope');
    if (row.status !== 'processing') reject('DIALOGUE_REQUEST_NOT_PROCESSING', 'Dialogue request is already terminal');
    db.prepare(`UPDATE town_dialogue_requests SET status = ?, reply_json = ?, error = ?, updated_at = ?
      WHERE request_id = ? AND status = 'processing'`).run(status, replyJson, error, Date.now(), args.requestId);
    return response(db.prepare('SELECT * FROM town_dialogue_requests WHERE request_id = ?').get(args.requestId));
  }).immediate();
}

/**
 * Caller must wrap message INSERTs and this call in the same db.transaction.
 * This nested transaction is a savepoint; it never commits the caller's transaction.
 * Repeated settlement throws so duplicate message INSERTs roll back as well.
 */
export function finishTownDialogueRequest(db, args) {
  return settle(db, args, 'completed', canonicalJson(args.reply), null);
}

/** Same caller-owned message transaction contract as finish. No retry or LLM invocation. */
export function failTownDialogueRequest(db, args) {
  nonempty(args.error, 'error');
  return settle(db, args, 'failed', null, args.error);
}

/** Call once at startup, before accepting requests (never while another worker is active). */
export function cleanupTownDialogueRequests(db) {
  const result = db.prepare(`UPDATE town_dialogue_requests SET status = 'failed', error = 'PROCESS_INTERRUPTED', updated_at = ?
    WHERE status = 'processing'`).run(Date.now());
  return { failedCount: result.changes };
}
