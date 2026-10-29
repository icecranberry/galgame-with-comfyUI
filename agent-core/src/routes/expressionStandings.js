import { Router } from 'express';
import { getDb } from '../db/index.js';
import { listExpressionStandings, listStandingOverview, startAllStandingBatches, startStandingBatch, controlStandingBatch, updateStandingPrompt, editStandingImage, deleteStanding } from '../services/expressionStandingService.js';
import { getStandingDisplay } from '../services/standingDisplay.js';
import { createStandingInteractionService } from '../services/standingInteractionService.js';
import { imageUrlExists } from '../services/imagePaths.js';
import { broadcast } from '../services/unifiedStreamBus.js';
import { saveTouchLines, fillMissingTouchLines } from '../services/standingTouchLines.js';
import { readStandingTouchLines, standingTouchSpeech } from '../services/standingTouchSpeechRuntime.js';
import { regenerateStandingTouchLines, generateStandingTouchLines } from '../services/expressionStandingService.js';
import { previewStandingBatches, previewCharacterStandingBatch } from '../services/expressionStandingService.js';

const router = Router();
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
router.get(base, (req, res) => res.json(listExpressionStandings(req.params.id)));
router.post(`${base}/preflight`, (req, res) => res.json(previewCharacterStandingBatch(req.params.id, req.body)));
router.post(`${base}/generate`, (req, res) => res.status(202).json(startStandingBatch(req.params.id, req.body)));
router.post(`${base}/jobs/:jobId/:action`, (req, res) => res.json(controlStandingBatch(req.params.id, req.params.jobId, req.params.action)));
router.patch(`${base}/:slot/prompt`, (req, res) => {
  updateStandingPrompt(req.params.id, req.params.slot, req.body.prompt, req.body.generation);
  res.json({ ok: true });
});
for (const action of ['upload', 'image', 'crop', 'hires']) {
  router.post(`${base}/:slot/${action}`, async (req, res) => {
    await editStandingImage(req.params.id, req.params.slot, action, req.body);
    res.json({ ok: true });
  });
}
router.delete(`${base}/:slot`, (req, res) => { deleteStanding(req.params.id, req.params.slot); res.json({ ok: true }); });
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
