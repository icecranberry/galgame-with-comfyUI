import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';
import { config } from '../src/config.js';

test('Comfy progress ignores other prompts and settles once when completion signals repeat', { timeout: 5000 }, async t => {
  const previous = config.comfyui.url;
  let historyRequests = 0, downloads = 0;
  const server = createServer((req, res) => {
    if (req.url === '/history/own-prompt') {
      historyRequests++;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ 'own-prompt': { outputs: { 1: { images: [{ filename: 'result.png' }] } } } }));
    } else if (req.url === '/object_info') { res.setHeader('Content-Type', 'application/json'); res.end('{}'); }
    else if (req.url.startsWith('/view?')) { downloads++; res.end(Buffer.from('original image')); }
    else { res.statusCode = 404; res.end(); }
  });
  const wss = new WebSocketServer({ server });
  t.after(() => {
    config.comfyui.url = previous;
    for (const client of wss.clients) client.terminate();
    wss.close(); server.closeAllConnections(); server.close();
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  config.comfyui.url = `http://127.0.0.1:${server.address().port}`;
  const { wsProgressAndDownload } = await import('../src/services/comfyClient.js');
  const connected = once(wss, 'connection');
  const events = [];
  const result = wsProgressAndDownload('client', 'own-prompt', event => events.push(event));
  const [socket] = await connected;
  const send = (type, data) => socket.send(JSON.stringify({ type, data }));
  send('progress', { prompt_id: 'other-prompt', value: 10, max: 10 });
  send('executing', { prompt_id: 'other-prompt', node: null });
  send('execution_error', { prompt_id: 'other-prompt', exception_message: 'unrelated failure' });
  send('execution_success', { prompt_id: 'other-prompt' });
  send('executing', { prompt_id: 'own-prompt', node: '1' });
  send('progress', { prompt_id: 'own-prompt', value: 2, max: 10 });
  send('execution_success', { prompt_id: 'own-prompt' });
  send('executing', { prompt_id: 'own-prompt', node: null });
  send('execution_success', { prompt_id: 'own-prompt' });
  send('progress', { prompt_id: 'own-prompt', value: 1, max: 10 });
  assert.equal((await result).images.length, 1);
  assert.deepEqual(events.map(event => event.phase), ['started', 'executing', 'sampling', 'executed', 'done']);
  assert.equal(events.find(event => event.phase === 'sampling').progress, 0.2);
  assert.equal(historyRequests, 1);
  assert.equal(downloads, 1);
});
