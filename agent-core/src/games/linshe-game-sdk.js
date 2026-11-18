/* LinSheGameSDK v1: automatically injected before the game's own scripts. */
(() => {
  if (window.LinSheGameSDK) return;
  const pending = new Map(), listeners = new Map(); let sequence = 0, channel, hostOrigin;
  const ready = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('请从邻舍游戏中心打开游戏，或重试连接')), 10000);
    window.addEventListener('message', event => {
      if (event.source !== window.parent || event.data?.type !== 'linshe:host:init' || typeof event.data.channel !== 'string' || channel) return;
      channel = event.data.channel; hostOrigin = event.origin; clearTimeout(timeout); resolve();
    });
  });
  ready.catch(() => {});
  window.addEventListener('message', event => {
    const message = event.data;
    if (event.source !== window.parent || event.origin !== hostOrigin || message?.channel !== channel) return;
    if (message.rpcType === 'event') { for (const callback of listeners.get(message.type) || []) Promise.resolve().then(() => callback(message.data)).catch(error => console.warn('[game event]', error)); return; }
    if (message.type !== 'linshe:rpc:result') return;
    const call = pending.get(message.id);
    if (!call) return;
    pending.delete(message.id); clearTimeout(call.timer);
    if (message.error) call.reject(new Error(message.error)); else call.resolve(message.result);
  });
  async function rpc(method, args = {}) {
    await ready;
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('游戏请求超时，请检查存档中的实际结果')); }, 600000);
      pending.set(id, { resolve, reject, timer });
      window.parent.postMessage({ type: 'linshe:rpc', channel, id, method, args }, hostOrigin);
    });
  }
  window.LinSheGameSDK = Object.freeze({
    ready,
    on(type, callback) { const group = listeners.get(type) || new Set(); group.add(callback); listeners.set(type, group); return () => group.delete(callback); },
    bridge: { call: (toolName, args = {}) => rpc('bridge', { toolName, args }) },
    llm: { chat: async (messages, options = {}) => (await rpc('llm', { messages, options })).content },
    image: { generate: options => rpc('image', options), promote: (sessionId, filename) => rpc('promote', { sessionId, filename }) },
    save: { list: () => rpc('save.list'), load: sessionId => rpc('save.load', { sessionId }),
      write: (sessionId, title, state, revision) => rpc('save.write', { sessionId, title, state, revision }), delete: sessionId => rpc('save.delete', { sessionId }) },
    ext: { request: (subPath, fetchOptions = {}) => rpc('ext', { subPath, fetchOptions }) },
    trpgAudio: { load: file => rpc('trpg.audio.load', { file }), preferences: settings => rpc('trpg.audio.preferences', { settings }) },
    ui: { exit: () => rpc('exit'), openStandings: subject => rpc('standings', { subject }) },
  });
  window.parent.postMessage({ type: 'linshe:game:ready' }, '*');
})();
