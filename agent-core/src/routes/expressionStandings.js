import { Router } from 'express';
import { getDb } from '../db/index.js';
import { PLAYER_STANDING_SUBJECT, listExpressionStandings, listStandingOverview, startAllStandingBatches, startStandingBatch, controlStandingBatch, updateStandingPrompt, editStandingImage, deleteStanding } from '../services/expressionStandingService.js';
import { getStandingDisplay } from '../services/standingDisplay.js';
import { createStandingInteractionService } from '../services/standingInteractionService.js';
import { imageUrlExists } from '../services/imagePaths.js';
import { broadcast } from '../services/unifiedStreamBus.js';
import { saveTouchLines, fillMissingTouchLines } from '../services/standingTouchLines.js';
import { readStandingTouchLines, standingTouchSpeech } from '../services/standingTouchSpeechRuntime.js';
import { regenerateStandingTouchLines, generateStandingTouchLines } from '../services/expressionStandingService.js';
import { previewStandingBatches, previewCharacterStandingBatch } from '../services/expressionStandingService.js';

const router = Router();
const playerBase = '/expression-standings/player';
router.put(`${playerBase}/:slot`, async (req, res) => {
  await editStandingImage(PLAYER_STANDING_SUBJECT, req.params.slot, 'upload', req.body);
  res.json(listExpressionStandings(PLAYER_STANDING_SUBJECT));
});
router.get('/expression-standings/overview', (_req, res) => res.json({ characters: listStandingOverview() }));
router.post('/expression-standings/preflight', (req, res) => res.json(previewStandingBatches(req.body)));
router.post('/expression-standings/generate', (req, res) => res.status(202).json(startAllStandingBatches(req.body)));
router.post('/expression-standings/touch-lines/fill', (_req,res)=>res.status(202).json(fillMissingTouchLines({db:getDb(),generate:generateStandingTouchLines,emit:broadcast})));
router.post('/expression-standings/touch-lines/speech/fill', (_req, res) => res.status(202).json(standingTouchSpeech().fill()));
const base = '/characters/:id/expression-standings';
const interactions = () => createStandingInteractionService({ db: getDb(), imageExists: imageUrlExists, emit: broadcast, readLines: readStandingTouchLines });
router.get(`${base}/touch-lines`, (req,res)=>{
  if(!getDb().prepare('SELECT id FROM characters WHERE id=?').get(req.params.id))return res.status(404).json({error:'角色不存在'});
  res.json(readStandingTouchLines(getDb(),req.params.id));
});
router.put(`${base}/touch-lines`, (req,res)=>{
  saveTouchLines({db:getDb(),id:Number(req.params.id),lines:req.body.lines,expectedVersion:req.body.expectedVersion,emit:broadcast});
  res.json(readStandingTouchLines(getDb(),req.params.id));
});
router.post(`${base}/touch-lines/speech`, (req, res) => res.status(202).json(standingTouchSpeech().generate(req.params.id, req.body)));
router.post(`${base}/touch-lines/generate`, (req,res)=>res.status(202).json(regenerateStandingTouchLines(req.params.id,req.body.expectedVersion)));
router.get('/characters/:id/standing-interaction', (req, res) => res.json(interactions().get(req.params.id)));
router.put('/characters/:id/standing-interaction', (req, res) => res.json(interactions().save(req.params.id, req.body)));
router.put(`${base}/:slot/interaction-regions`, (req, res) => res.json(interactions().saveRegions(req.params.id, req.params.slot, req.body)));
router.post(`${base}/preflight`, (req, res) => res.json(previewCharacterStandingBatch(req.params.id, req.body)));
function mountStandingRoutes(basePath, subject) {
  router.get(basePath, (req, res) => res.json(listExpressionStandings(subject(req))));
  router.post(`${basePath}/generate`, (req, res) => res.status(202).json(startStandingBatch(subject(req), req.body)));
  router.post(`${basePath}/jobs/:jobId/:action`, (req, res) => res.json(controlStandingBatch(subject(req), req.params.jobId, req.params.action, undefined, req.body)));
  router.patch(`${basePath}/:slot/prompt`, (req, res) => {
    updateStandingPrompt(subject(req), req.params.slot, req.body.prompt, req.body.generation);
    res.json({ ok: true });
  });
  for (const action of ['upload', 'image', 'crop', 'hires']) {
    router.post(`${basePath}/:slot/${action}`, async (req, res) => {
      await editStandingImage(subject(req), req.params.slot, action, req.body);
      res.json({ ok: true });
    });
  }
  router.delete(`${basePath}/:slot`, (req, res) => {
    const id = subject(req);
    deleteStanding(id, req.params.slot);
    res.json(id === PLAYER_STANDING_SUBJECT ? listExpressionStandings(id) : { ok: true });
  });
}
mountStandingRoutes(base, req => Number(req.params.id));
mountStandingRoutes(playerBase, () => PLAYER_STANDING_SUBJECT);
router.get('/standing-display/state', (_req, res) => res.json(getStandingDisplay().snapshot()));
router.get('/characters/:id/standing-display', (req, res) => {
  if (!getDb().prepare('SELECT id FROM characters WHERE id=?').get(req.params.id)) return res.status(404).json({ error: '角色不存在' });
  res.json(getStandingDisplay().characterSnapshot(req.params.id));
});
router.put('/standing-display/active', (req, res) => {
  const { characterId, clientId, sequence } = req.body;
  if (!Number.isInteger(Number(characterId)) || !getDb().prepare('SELECT id FROM characters WHERE id=?').get(characterId)) return res.status(404).json({ error: '角色不存在' });
  res.json(getStandingDisplay().select(Number(characterId), String(clientId || '').slice(0, 100), Number(sequence)));
});
export default router;
