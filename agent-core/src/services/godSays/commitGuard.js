// Same-process loopback requests carry a one-use guard. Check at the receiving side,
// immediately before the existing synchronous configuration route performs its write.
const guards = new Map();
export function registerGodCommitGuard(key, check) {
  guards.set(key, check);
  return () => guards.delete(key);
}
export function godCommitGuard(req, res, next) {
  try { assertGodCommit(req); next(); }
  catch (err) { res.status(409).json({ error: err.message }); }
}
export function assertGodCommit(req) {
  const key = req.get('X-Linshe-God-Operation');
  const check = key && guards.get(key);
  if (check) check();
}
