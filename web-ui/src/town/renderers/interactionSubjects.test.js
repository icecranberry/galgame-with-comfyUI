import test from 'node:test'
import assert from 'node:assert/strict'
import {interactionSubjectKeys,isInteractionSubject} from './interactionSubjects.js'

test('omitted/invalid interaction keys only select me, never infer focus from positions',()=>{
  for(const input of [undefined,null,{},'npc:1'])assert.deepEqual([...interactionSubjectKeys(input)],['me'])
  assert(isInteractionSubject({agentKey:'me'},interactionSubjectKeys()))
  assert(!isInteractionSubject({agentKey:'npc:1',ground:{x:0,z:0}},interactionSubjectKeys()))
})
test('explicit actor identity or agent key selects hovered/selected/dialogue actors; stale keys select nobody else',()=>{
  const keys=interactionSubjectKeys(['actor:stable','npc:2','npc:2',null])
  assert(isInteractionSubject({agentKey:'npc:1',actorId:'actor:stable'},keys))
  assert(isInteractionSubject({agentKey:'npc:2'},keys))
  assert(!isInteractionSubject({agentKey:'npc:3'},keys))
  assert.deepEqual([...interactionSubjectKeys([])],['me'])
})
