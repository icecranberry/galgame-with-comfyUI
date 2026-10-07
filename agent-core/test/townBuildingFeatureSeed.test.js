import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.js';
import { seedTownBuildingFeatures } from '../src/services/town/townBuildingFeatureSeed.js';

test('开镇仅补齐缺失/失败功能，单栋失败继续，保留既有及手工配置', async () => {
  const previous = config.features.townBuildingFeatures;
  config.features.townBuildingFeatures = true;
  try {
    const calls = [];
    const result = await seedTownBuildingFeatures({ mapId: 42 }, {
      listTownBuildingFeatureCandidates: ({ mapId }) => {
        assert.equal(mapId, 42);
        return ['unconfigured', 'failed', 'ready', 'partial', 'disabled', 'generating', 'stale']
          .map(status => ({ locationKey: status, status }))
          .concat({ locationKey: 'manual', status: 'failed', manual: true });
      },
      generateTownBuildingFeatures: async args => {
        calls.push(args);
        if (args.locationKey === 'unconfigured') throw new Error('mock failure');
      },
    });
    assert.deepEqual(calls, [
      { mapId: 42, locationKey: 'unconfigured', force: false },
      { mapId: 42, locationKey: 'failed', force: false },
    ]);
    assert.deepEqual(result, { generated: 1, failed: 1, skipped: 6 });
    let current = true;
    await assert.rejects(seedTownBuildingFeatures({ mapId: 42, assertCurrent: () => {
      if (!current) throw new Error('stale init');
    } }, {
      listTownBuildingFeatureCandidates: () => ['a', 'b'].map(locationKey => ({ locationKey, status: 'unconfigured' })),
      generateTownBuildingFeatures: async () => { current = false; },
    }), /stale init/);
  } finally {
    config.features.townBuildingFeatures = previous;
  }
});
