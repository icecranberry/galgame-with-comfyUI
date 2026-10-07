import { test } from 'node:test'
import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import { createClientRequestId } from '../src/utils/clientRequestId.js'

test('HTTP LAN clients without randomUUID can create unique UUID v4 request tokens', () => {
  const httpCrypto = { getRandomValues: bytes => webcrypto.getRandomValues(bytes) }
  const ids = Array.from({ length: 100 }, () => createClientRequestId(httpCrypto))
  assert.equal(new Set(ids).size, 100)
  for (const id of ids) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
})

test('secure origins retain native UUID generation', () => {
  assert.equal(createClientRequestId({ randomUUID: () => 'native-id' }), 'native-id')
})
