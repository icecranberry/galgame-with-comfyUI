import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTownTargetTradeCommand } from '../src/api/townLife.js'

test('trade commands keep the resolved target path and never accept client prices', () => {
  const command = createTownTargetTradeCommand('npc:3', { worldId: 'town', worldEpoch: 1, templateId: 'town.mood_patch' })
  assert.equal(command.path, '/npcs/3/trade')
  assert.equal(command.body.templateId, 'town.mood_patch', 'only the resolved item id is sent; the server decides the price')
})
