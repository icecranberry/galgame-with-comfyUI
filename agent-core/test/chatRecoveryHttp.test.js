import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import express from 'express';

process.env.DB_PATH = ':memory:';
globalThis.fetch = async () => { throw new Error('External network forbidden'); };
const { config } = await import('../src/config.js');
config.dbPath = ':memory:';
const { getDb, closeDb } = await import('../src/db/index.js');
const { default: router } = await import('../src/routes/chat.js');
const { savePrivateChatReply } = await import('../src/services/privateChatImageTools.js');
function request(port, method, path, body) {
  return new Promise((resolve,reject)=>{
    const req=http.request({host:'127.0.0.1',port,method,path,headers:{'Content-Type':'application/json'}},res=>{
      let text=''; res.on('data',chunk=>text+=chunk); res.on('end',()=>resolve({status:res.statusCode,text}));
    });
    req.on('error',reject);req.end(body?JSON.stringify(body):undefined);
  });
}
test('完成通知丢失后真实HTTP重试直接回放；角色已睡着也不重新排队',async t=>{
  const db=getDb();t.after(()=>closeDb());
  const id=db.prepare("INSERT INTO characters(name,display_name,base_prompt,is_sleeping) VALUES ('recovery-http','测试','测试',1)").run().lastInsertRowid;
  const conversationId=`char_${id}`;
  const user=db.prepare("INSERT INTO raw_messages(conversation_id,role,content,client_msg_id) VALUES (?,'user','你好','recovery-http-key')").run(conversationId).lastInsertRowid;
  db.prepare("INSERT INTO messages(conversation_id,raw_id,role,content,seq) VALUES (?,?,'user','你好',0)").run(conversationId,user);
  savePrivateChatReply(db,{conversationId,userRawId:user,content:'已经写完的回复',segments:[{content:'已经写完的回复',images:[]}]});
  config.features.schedule=true;
  const app=express();app.use(express.json());app.use('/api',router);
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const port=server.address().port;
  const result=await request(port,'POST',`/api/characters/${id}/chat`,{message:'你好',client_msg_id:'recovery-http-key'});
  assert.equal(result.status,200);assert.match(result.text,/已经写完的回复/);assert.match(result.text,/event: dialogue_saved/);
  assert.doesNotMatch(result.text,/queued/);
  assert.equal(db.prepare('SELECT count(*) n FROM messages WHERE conversation_id=?').get(conversationId).n,2);
  assert.equal(db.prepare('SELECT count(*) n FROM reply_queue WHERE conversation_id=?').get(conversationId).n,0);
  const history=JSON.parse((await request(port,'GET',`/api/characters/${id}/messages`)).text);
  assert.deepEqual(history.completedClientMsgIds,['recovery-http-key']);
  assert.equal(history.messages[0].client_msg_id,'recovery-http-key');
});
