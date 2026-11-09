import express from 'express';
import { createPhotoStudioService, getRecognizedPoseCatalog, photoStudioCapability, POSE_GALLERY_DIR } from '../services/photoStudioService.js';

const router = express.Router();
const studio = createPhotoStudioService();
router.use('/assets', express.static(POSE_GALLERY_DIR, { maxAge: '7d', index: false, dotfiles: 'deny' }));
router.get('/catalog', async (_req, res) => res.json({ poses: await getRecognizedPoseCatalog() }));
router.get('/capability', async (_req, res) => res.json(await photoStudioCapability()));
router.get('/characters', (_req, res) => res.json({ characters: studio.listCharacters() }));
router.get('/jobs', (_req, res) => res.json({ jobs: studio.list() }));
router.post('/prompt-preview', async (req, res) => {
  try { res.json(await studio.preview(req.body || {})); }
  catch (error) { res.status(error.status || 500).json({ error: error.message }); }
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
