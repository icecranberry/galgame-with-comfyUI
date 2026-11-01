import { getDb } from '../../db/index.js';
import { worldEventContext } from './worldEvents.js';

export function getGodWorldContext(characterIds = null) {
  return worldEventContext(getDb(), characterIds);
}
