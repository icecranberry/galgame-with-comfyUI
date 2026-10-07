import { config } from '../../config.js';

/** 开镇后补齐特殊建筑功能；复用管理入口的同名共享、生成锁和世界隔离。 */
export async function seedTownBuildingFeatures({ mapId, assertCurrent = () => {} } = {}, runtime) {
  const summary = { generated: 0, skipped: 0, failed: 0 };
  if (!config.features.townBuildingFeatures) return summary;
  const { listTownBuildingFeatureCandidates, generateTownBuildingFeatures } = runtime
    || await import('./townBuildingFeatureRuntime.js');
  assertCurrent();
  const candidates = listTownBuildingFeatureCandidates({ mapId });
  for (const candidate of candidates) {
    assertCurrent();
    if (candidate.manual || !['unconfigured', 'failed'].includes(candidate.status)) {
      summary.skipped++;
      continue;
    }
    try {
      await generateTownBuildingFeatures({ mapId, locationKey: candidate.locationKey, force: false });
      summary.generated++;
    } catch (err) {
      summary.failed++;
      console.warn(`[townInit] building ${candidate.locationKey} features failed:`, err?.message || err);
    }
  }
  return summary;
}
