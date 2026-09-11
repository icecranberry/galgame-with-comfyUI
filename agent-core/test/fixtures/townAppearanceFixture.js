import { readFileSync } from 'node:fs';
import { compileFunction } from 'node:vm';

/** Actual central persona/outfit code, explicit fixture DB boundary, no singleton imports. */
export function centralPersonaFixture(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS global_outfits(id INTEGER PRIMARY KEY,name TEXT,description TEXT,enabled INTEGER,
    character_id INTEGER,expires_at TEXT);
    CREATE TABLE IF NOT EXISTS character_outfits(id INTEGER PRIMARY KEY,character_id INTEGER,name TEXT,
    description TEXT,enabled INTEGER,created_at TEXT,expires_at TEXT);`);
  const outfit=readFileSync(new URL('../../src/services/outfitService.js',import.meta.url),'utf8')
    .replace(/import \{ getDb \} from '[^']+';/,'').replace(/export function /g,'function ');
  const getActiveOutfits=compileFunction(`${outfit}\nreturn getActiveOutfits;`,['getDb'])(()=>db);
  const persona=readFileSync(new URL('../../src/services/characterPersona.js',import.meta.url),'utf8')
    .replace(/import \{ getActiveOutfits \} from '[^']+';/,'').replace(/export function /g,'function ');
  return compileFunction(`${persona}\nreturn {buildCharacterAppearanceSection,buildCharacterPersona};`,['getActiveOutfits'])(getActiveOutfits);
}
