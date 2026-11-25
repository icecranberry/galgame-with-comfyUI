import { createHash } from 'node:crypto';
import { Router } from 'express';
import { getDb } from '../db/index.js';
import { buildStructuredPersona } from '../services/characterGenerator.js';
import { cropPersonalityForEmotion } from '../services/emotionEngine.js';
import { listSceneOutfits } from '../services/outfitScene.js';
import { cleanGeneratedPersona } from '../services/structuredPersonaPrompt.js';
import { extractPersonaIp, readLegacyAppearance, splitPersonaForUpgrade } from '../shared/personaSectionUtils.js';

const conflict = () => Object.assign(new Error('角色资料已变化，请重新打开详情后再试'), { status: 409 });

function readCharacter(db, id) {
  const character = db.prepare('SELECT id, display_name, name, base_prompt, short_prompt FROM characters WHERE id = ?').get(id);
  if (!character) throw Object.assign(new Error('角色不存在'), { status: 404 });
  return character;
}

function personaRevision({ id, name, display_name, base_prompt }) {
  return createHash('sha256').update(JSON.stringify([id, name, display_name, base_prompt])).digest('hex');
}

export function createPersonaUpgradeRouter({ buildPersona = buildStructuredPersona } = {}) {
  const router = Router();
  const running = new Map();

  router.post('/:id/persona-draft', async (req, res) => {
    const id = Number(req.params.id);
    const db = getDb();
    if (running.has(id)) return res.status(409).json({ error: '该角色正在生成人设' });
    const controller = new AbortController();
    running.set(id, controller);
    const release = () => { if (running.get(id) === controller) running.delete(id); };
    res.once('close', () => { controller.abort(); release(); });
    const stream = req.accepts(['json', 'text/event-stream']) === 'text/event-stream';
    const send = (event, data) => {
      if (!res.destroyed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    let heartbeat;
    try {
      const character = readCharacter(db, id);
      const body = req.body || {};
      const reuse = body.search_context !== undefined;
      if (reuse && typeof body.search_context !== 'string') return res.status(400).json({ error: '检索资料必须是文本' });
      if (body.expected_base_prompt !== undefined && body.expected_base_prompt !== character.base_prompt) throw conflict();
      const name = character.display_name || character.name;
      const { persona: extraContext } = splitPersonaForUpgrade(character.base_prompt);
      const ip = extractPersonaIp(extraContext);
      if (stream) {
        res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' });
        res.flushHeaders();
        heartbeat = setInterval(() => { if (!res.destroyed) res.write(': keepalive\n\n'); }, 15000);
      }
      const result = await buildPersona({
        name, ip, original: !ip, extraContext, signal: controller.signal,
        skipWebSearch: reuse, fetchedMaterials: ip && reuse ? body.search_context : '',
        onStage: (stage, details) => { if (stream) send('stage', { stage, ...details }); },
      });
      controller.signal.throwIfAborted();
      const revision = personaRevision(character);
      if (personaRevision(readCharacter(db, id)) !== revision) throw conflict();
      const data = { id, persona: result.persona, source_revision: revision, search_found: !!result.searchContext };
      if (stream) { send('result', data); res.end(); }
      else res.json({ ...data, source: result.searchContext ? 'network' : ip ? 'not-found' : 'original', search_context: result.searchContext });
    } catch (error) {
      if (res.destroyed) return;
      if (res.headersSent) { send('error', { error: error.message }); res.end(); }
      else res.status(error.status || 502).json({ error: error.message });
    } finally {
      clearInterval(heartbeat);
      release();
    }
  });

  router.post('/:id/apply-persona', (req, res) => {
    const id = Number(req.params.id);
    const { persona, source_revision } = req.body || {};
    if (typeof persona !== 'string' || !persona.trim() || typeof source_revision !== 'string' || !source_revision) {
      return res.status(400).json({ error: '缺少待确认的人设或角色版本' });
    }
    const db = getDb();
    try {
      const saved = db.transaction(() => {
        const current = readCharacter(db, id);
        const { persona: previous, suffix } = splitPersonaForUpgrade(current.base_prompt);
        if (personaRevision(current) !== source_revision) {
          // 确认响应丢失后重试时，已经生效的同一份正文直接返回。
          if (previous === persona) return { id, base_prompt: current.base_prompt, short_prompt: current.short_prompt };
          throw conflict();
        }
        const name = current.display_name || current.name;
        const ip = extractPersonaIp(previous);
        let front;
        try { front = cleanGeneratedPersona(persona, { name, ip, original: !ip, sourcePersona: previous }).persona; }
        catch (error) { throw Object.assign(error, { status: 400 }); }
        let preserved = suffix;
        if (!preserved) {
          const defaultLook = listSceneOutfits(id).find(outfit => outfit.scene === 'work')?.description;
          const appearance = defaultLook?.trim() ? defaultLook : readLegacyAppearance(previous);
          if (appearance) preserved = '\n\n## 你的外观\n' + appearance;
        }
        const base = front + preserved;
        const short = cropPersonalityForEmotion(front, name);
        db.prepare('UPDATE characters SET base_prompt = ?, short_prompt = ? WHERE id = ?').run(base, short, id);
        db.prepare('UPDATE town_npcs SET persona = ?, brief = ? WHERE character_id = ? AND character_managed = 1').run(base, short, id);
        // 早期版本可能留有该角色的备份，确认替换时一并清理。
        if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'character_persona_backups'").get()) {
          db.prepare('DELETE FROM character_persona_backups WHERE character_id = ?').run(id);
        }
        return { id, base_prompt: base, short_prompt: short };
      }).immediate();
      res.json(saved);
    } catch (error) {
      res.status(error.status || 500).json({ error: error.message });
    }
  });
  return router;
}
