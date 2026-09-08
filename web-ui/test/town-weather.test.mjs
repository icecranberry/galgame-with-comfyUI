import test from 'node:test'
import assert from 'node:assert/strict'
import { formatTownTemperature } from '../src/utils/townWeather.js'

test('temperature measurements get units while weather cache labels remain labels', () => {
  assert.equal(formatTownTemperature(0), '0°C')
  assert.equal(formatTownTemperature(-3.5), '-3.5°C')
  assert.equal(formatTownTemperature(' 24.5 '), '24.5°C')
  assert.equal(formatTownTemperature('挺舒服'), '挺舒服')
  assert.equal(formatTownTemperature('偏凉'), '偏凉')
})

test('missing or invalid temperature values do not create garbage chips', () => {
  for (const value of [null, undefined, '', '  ', NaN, Infinity, 'NaN', 'Infinity', '1e999', {}, [], true]) {
    assert.equal(formatTownTemperature(value), '')
  }
})
