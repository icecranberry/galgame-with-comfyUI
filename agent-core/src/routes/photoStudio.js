import express from 'express';
import { createPhotoStudioService, getRecognizedPoseCatalog, photoStudioCapability, POSE_GALLERY_DIR } from '../services/photoStudioService.js';
import { getStudioBackgrounds, generateStudioBackground } from '../services/photoStudioBackgrounds.js';
import { describeStudioPose } from '../services/photoStudioPose.js';
import { queryStudioCatalog } from '../services/photoStudioCatalog.js';
import { createPhotoStudioFinishService } from '../services/photoStudioFinish.js';
import { broadcast } from '../services/unifiedStreamBus.js';
import { createPhotoStudioQueue } from '../services/photoStudioQueue.js';

const router = express.Router();
const studio = createPhotoStudioService();
const finishes = createPhotoStudioFinishService();
export const photoStudioQueue = createPhotoStudioQueue({ studio, finishes });
router.post('/batches', async (req, res) => {
  try { res.status(202).json({ batch: await photoStudioQueue.submit(req.body || {}) }); }
  catch (error) { res.status(error.status || 500).json({ error: error.message }); }
});
router.get('/batches/:id', (req, res) => {
  const batch = photoStudioQueue.get(req.params.id);
  if (!batch) return res.status(404).json({ error: '找不到这组连拍' });
  res.json({ batch });
});
router.post('/batches/:id/stop', (req, res) => {
  try { res.json({ batch: photoStudioQueue.stop(req.params.id) }); }
  catch (error) { res.status(error.status || 500).json({ error: error.message }); }
});
router.get('/finishes', (_req, res) => res.json({ finishes: finishes.list(), defaults: finishes.defaults() }));
router.put('/finish-defaults', (req, res) => {
  try { res.json({ defaults: finishes.setDefaults(req.body || {}) }); }
  catch (error) { res.status(error.status || 500).json({ error: error.message }); }
});
router.post('/jobs/:id/finish/retry', async (req, res) => {
  try { res.json({ job: await studio.retryFinish(req.params.id) }); }
  catch (error) { res.status(error.status || 500).json({ error: error.message }); }
});
router.put('/jobs/:id/finish', express.raw({ type: 'image/png', limit: '32mb' }), async (req, res) => {
  try {
    let recipe;
    try { recipe = JSON.parse(decodeURIComponent(req.get('X-Studio-Recipe') || '')); }
    catch { return res.status(400).json({ error: '装裱参数无效' }); }
    const reuse = req.get('X-Studio-Reuse') ?? 'true';
    if (!['true', 'false'].includes(reuse)) return res.status(400).json({ error: '新片沿用参数无效' });
    const finish = await finishes.store(req.params.id, recipe, req.body, { reuseForNewPhotos: reuse === 'true' });
    broadcast('photo_studio_ready', { job: studio.job(req.params.id) });
    res.json({ finish, defaults: finishes.defaults() });
  } catch (error) { res.status(error.status || 500).json({ error: error.message }); }
});
router.use('/assets', express.static(POSE_GALLERY_DIR, { maxAge: '7d', index: false, dotfiles: 'deny' }));
router.get('/catalog', async (req, res) => {
  try {
    const poses = await getRecognizedPoseCatalog();
    if (!Object.keys(req.query).length) return res.json({ poses });
    const { entries, ...pagination } = queryStudioCatalog(poses, req.query, { poses: true });
    res.json({ poses: entries, ...pagination });
  } catch (error) { res.status(error.status || 500).json({ error: error.message }); }
});
router.get('/capability', async (_req, res) => res.json(await photoStudioCapability()));
router.get('/characters', (_req, res) => res.json({ characters: studio.listCharacters() }));
router.get('/backgrounds', (req, res) => {
  try {
    const catalog = getStudioBackgrounds();
    if (!Object.keys(req.query).length) return res.json(catalog);
    const { entries, ...pagination } = queryStudioCatalog(catalog.entries, req.query);
    res.json({ ...catalog, entries, ...pagination });
  } catch (error) { res.status(error.status || 500).json({ error: error.message }); }
});
router.post('/describe-pose', async (req, res) => {
  try { res.json(await describeStudioPose(req.body || {})); }
  catch (error) { res.status(error.status || 502).json({ error: error.message }); }
});
router.post('/background-draft', async (req, res) => {
  try { res.json(await generateStudioBackground(req.body?.description)); }
  catch (error) { res.status(error.status || 502).json({ error: error.message }); }
});
router.get('/jobs', (_req, res) => res.json({ jobs: studio.list(), batch: photoStudioQueue.current() }));
router.post('/prompt-preview', async (req, res) => {
  try { res.json(await studio.preview(req.body || {})); }
  catch (error) { res.status(error.status || 500).json({ error: error.message }); }
});
router.post('/clothing-draft', async (req, res) => {
  try { res.json(await studio.clothingDraft(req.body || {})); }
  catch (error) { res.status(error.status || 502).json({ error: error.message }); }
});
router.get('/jobs/:id', (req, res) => {
  const job = studio.job(req.params.id);
  if (!job) return res.status(404).json({ error: '找不到这次拍摄' });
  res.json({ job });
});
router.post('/jobs', async (req, res) => {
  try { res.status(202).json({ job: await studio.submit(req.body || {}) }); }
  catch (error) { res.status(error.status || 500).json({ error: error.message }); }
});
export default router;
