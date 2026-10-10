import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../config.js';
import { recallMomentMemories as recall, formatMomentMemories } from './momentMemoryRecall.js';

const scope = ['char-7'];
const recallMomentMemories = (scope, queries, deps = {}) => recall(scope, queries, { rerankMemories: async (_query, hits) => hits, ...deps });

function useMemory(enabled) {
  const original = config.features.memory;
  config.features.memory = enabled;
  return () => {
    config.features.memory = original;
  };
}

test('记忆特性关闭时不发起检索', async () => {
  const restore = useMemory(false);
  let calls = 0;
  try {
    const memories = await recallMomentMemories(scope, { postText: '今天天气不错' }, {
      hybridSearch: async () => {
        calls += 1;
        return [];
      },
    });
    assert.deepEqual(memories, []);
    assert.equal(calls, 0);
  } finally {
    restore();
  }
});

test('无查询词时不发起检索', async () => {
  const restore = useMemory(true);
  let calls = 0;
  try {
    const memories = await recallMomentMemories(scope, {}, {
      hybridSearch: async () => {
        calls += 1;
        return [];
      },
    });
    assert.deepEqual(memories, []);
    assert.equal(calls, 0);
  } finally {
    restore();
  }
});

test('无会话范围时不发起检索', async () => {
  const restore = useMemory(true);
  let calls = 0;
  try {
    const memories = await recallMomentMemories([], { postText: '今天天气不错' }, {
      hybridSearch: async () => {
        calls += 1;
        return [];
      },
    });
    assert.deepEqual(memories, []);
    assert.equal(calls, 0);
  } finally {
    restore();
  }
});

test('分别以朋友圈文案与评论区内容检索说话者的记忆，并按 memory_id 合并去重', async () => {
  const restore = useMemory(true);
  const calls = [];
  const fakeSearch = async (query, options) => {
    calls.push({ query, options });
    if (query === '今天天气不错') {
      return [
        { memory_id: 1, memory_type: '偏好', judgment: '喜欢晴天' },
        { memory_id: 2, memory_type: '关系', judgment: '和用户关系很好' },
      ];
    }
    return [
      { memory_id: 2, memory_type: '关系', judgment: '和用户关系很好' },
      { memory_id: 3, memory_type: '事件', judgment: '一起去过海边' },
    ];
  };
  try {
    const memories = await recallMomentMemories(scope, {
      postText: '今天天气不错',
      commentText: ['好久没见了', '最近在忙什么'],
    }, { hybridSearch: fakeSearch });

    assert.equal(calls.length, 2);
    assert.equal(calls[1].query, '今天天气不错');
    assert.equal(calls[0].query, '好久没见了 最近在忙什么');
    assert.deepEqual(calls[0].options.conversationIds, ['char-7']);
    assert.equal(calls[0].options.topK, 5);
    assert.deepEqual(memories.map((memory) => memory.memory_id), [2, 1, 3]);
  } finally {
    restore();
  }
});

test('过滤掉事件 / 奇遇 / 未互动事件类记忆', async () => {
  const restore = useMemory(true);
  try {
    const memories = await recallMomentMemories(scope, { postText: '海边' }, {
      hybridSearch: async () => ([
        { memory_id: 1, memory_type: '事件', judgment: '【事件】【奇遇】未互动事件：在海边遇到一只猫' },
        { memory_id: 2, memory_type: '事件', judgment: '【事件】在海边散步' },
      ]),
    });
    assert.deepEqual(memories.map((memory) => memory.memory_id), [2]);
  } finally {
    restore();
  }
});

test('检索抛错时返回空数组且不向外抛', async () => {
  const restore = useMemory(true);
  const originalError = console.error;
  console.error = () => {};
  try {
    const memories = await recallMomentMemories(scope, { postText: '海边' }, {
      hybridSearch: async () => {
        throw new Error('boom');
      },
    });
    assert.deepEqual(memories, []);
  } finally {
    console.error = originalError;
    restore();
  }
});

test('检索超时按无结果处理', async () => {
  const restore = useMemory(true);
  try {
    const memories = await recallMomentMemories(scope, { postText: '海边' }, {
      hybridSearch: () => new Promise(() => {}),
      timeoutMs: 20,
    });
    assert.deepEqual(memories, []);
  } finally {
    restore();
  }
});

test('formatMomentMemories 输出说话者视角的相关记忆', () => {
  const block = formatMomentMemories([
    { memory_type: '偏好', judgment: '喜欢晴天' },
    { memory_type: '关系', judgment: '和用户关系很好' },
  ], '小明');
  assert.equal(
    block,
    '<rag_memories>\n小明记得的相关信息（只在相关时自然提及，不要把他人的经历说成自己的）：\n1. [偏好] 喜欢晴天\n2. [关系] 和用户关系很好\n</rag_memories>',
  );
});

test('formatMomentMemories 名字缺失时兜底为 TA', () => {
  const block = formatMomentMemories([{ memory_type: '偏好', judgment: '喜欢晴天' }], '');
  assert.equal(
    block,
    '<rag_memories>\nTA记得的相关信息（只在相关时自然提及，不要把他人的经历说成自己的）：\n1. [偏好] 喜欢晴天\n</rag_memories>',
  );
});


test('四路候选统一重排后仅保留匹配最高三条，联想结果也参与排序', async () => {
  const restore = useMemory(true);
  const calls = [];
  try {
    const memories = await recallMomentMemories(scope, {
      postText: '咖啡店', commentText: '上次太甜', threadText: ['那杯拿铁'], imageText: '蛋糕',
    }, {
      activeMemorySearch: async (query, options) => {
        calls.push({ query, options });
        return { results: [1, 2, 3, 4, 5].map(id => ({ memory_id: id, judgment: `记忆${id}`, sources: ['entity_hop'] })) };
      },
      rerankMemories: async (query, candidates) => {
        assert.equal(query, '上次太甜\n那杯拿铁\n咖啡店\n蛋糕');
        assert.equal(candidates.length, 5);
        return [5, 3, 4, 1, 2].map(id => candidates.find(m => m.memory_id === id));
      },
    });
    assert.equal(calls.length, 4);
    assert.ok(calls.every(c => c.options.topK === 5 && c.options.conversationIds[0] === 'char-7'));
    assert.deepEqual(memories.map(m => m.memory_id), [5, 3, 4]);
  } finally { restore(); }
});

test('重复查询只查一次；重排超时保留融合前三条', async () => {
  const restore = useMemory(true);
  let calls = 0;
  try {
    const memories = await recallMomentMemories(scope, { postText: '海边', commentText: '海边' }, {
      timeoutMs: 20,
      activeMemorySearch: async () => {
        calls++;
        return { results: [1, 2, 3, 4].map(id => ({ memory_id: id, judgment: '海边' })) };
      },
      rerankMemories: () => new Promise(() => {}),
    });
    assert.equal(calls, 1);
    assert.deepEqual(memories.map(m => m.memory_id), [1, 2, 3]);
  } finally { restore(); }
});

test('某一路失败仍保留其他路命中的记忆', async () => {
  const restore = useMemory(true);
  try {
    const memories = await recallMomentMemories(scope, { postText: '咖啡', commentText: '甜点' }, {
      activeMemorySearch: async query => {
        if (query === '甜点') throw new Error('单路失败');
        return { results: [{ memory_id: 9, judgment: '喜欢咖啡' }] };
      },
    });
    assert.equal(memories[0].memory_id, 9);
  } finally { restore(); }
});

test('历史联想保留过时标记，不作为现行事实注入', () => {
  assert.match(formatMomentMemories([{ memory_type: '偏好', isHistorical: true, injectionText: '以前喜欢甜食' }], '角色'), /历史·过时.*以前喜欢甜食/);
});
