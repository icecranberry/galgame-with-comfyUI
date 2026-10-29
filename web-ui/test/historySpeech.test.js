import test from 'node:test'
import assert from 'node:assert/strict'
import { historySpeechLines, dialoguePageSpeechIds } from '../src/utils/historySpeech.js'

test('history buttons use real message IDs and preserve all original text and paragraphs', () => {
  const message = {id:1,role:'assistant',content:'（挥手）你好。\n\n你好。尾声',speech_segments:[{id:101,content:'你好。'},{id:102,content:'你好。'}]}
  const lines = historySpeechLines(message)
  assert.deepEqual(lines.map(line => line.messageId), [101,102,null])
  assert.equal(lines.map(line => line.text).join(''),message.content)
})
test('unmatched text, users and image-only messages never get invented speech IDs', () => {
  const message = {id:1,role:'assistant',content:'完整原文',speech_segments:[{id:101,content:'旧文本'}]}
  assert.deepEqual(historySpeechLines(message),[{text:'完整原文',messageId:null}])
  assert.deepEqual(historySpeechLines({...message,role:'user',speech_segments:[{id:101,content:'完整原文'}]}),[{text:'完整原文',messageId:null}])
  assert.deepEqual(historySpeechLines({...message,content:''}),[])
})

test('stripped punctuation stays before the button and wrapped quoted lines still match', () => {
  const message = {role:'assistant',content:'你好。\n“今天\n一起走吧”。',speech_segments:[{id:1,content:'你好'},{id:2,content:'“今天一起走吧”'}]}
  const lines = historySpeechLines(message)
  assert.deepEqual(lines,[{text:'你好。',messageId:1},{text:'\n“今天\n一起走吧”。',messageId:2}])
})


test('main dialogue reads only the page sentences, including a sentence continued across pages', () => {
  const message = {id:99,role:'assistant',content:'第一句。\n第二句话。第三句。',speech_segments:[{id:10,content:'第一句'},{id:11,content:'第二句话'},{id:12,content:'第三句'}]}
  const pages = ['第一句。\n', '第二句', '话。第三句。']
  assert.deepEqual(dialoguePageSpeechIds(message,pages,0),[10])
  assert.deepEqual(dialoguePageSpeechIds(message,pages,1),[11])
  assert.deepEqual(dialoguePageSpeechIds(message,pages,2),[11,12])
  assert.deepEqual(dialoguePageSpeechIds(message,['旧页面'],0),[])
  assert.deepEqual(dialoguePageSpeechIds(undefined,pages,0),[])
  assert.deepEqual(dialoguePageSpeechIds({...message,role:'user'},pages,0),[])
  assert.deepEqual(dialoguePageSpeechIds({role:'assistant',content:'',images:['/photo.png']},[''],0),[])
})
