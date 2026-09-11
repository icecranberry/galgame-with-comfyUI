import { createHash } from 'node:crypto';

const stale = () => Object.assign(new Error('生成所用外观已变化，请重新生成'), {code:'TOWN_ASSET_STALE'});

/** Explicit DB and central characterPersona builders. No model, write, timer or outfit parser.
 * Capture once before prompt generation; use exactly appearanceInfo as its input.
 * Only the opaque signature/identity source belongs in asset metadata, never this closure.
 */
export function createTownAppearanceSignature({db,buildAppearanceSection,buildPersona}) {
  if (!db?.prepare || typeof buildAppearanceSection!=='function' || typeof buildPersona!=='function') throw new TypeError('Appearance dependencies required');
  function capture({sourceKind,sourceId,mode='sprite',styleTags=''}) {
    if (!['character','npc'].includes(sourceKind) || !Number.isSafeInteger(sourceId) || sourceId<1
      || !['sprite','portrait'].includes(mode)) throw new TypeError('Invalid appearance source');
    const row=db.prepare(`SELECT * FROM ${sourceKind==='character'?'characters':'town_npcs'} WHERE id=?`).get(sourceId);
    if (!row) throw stale();
    const characterId=sourceKind==='character'?row.id:
      (row.character_id && db.prepare('SELECT id FROM characters WHERE id=?').get(row.character_id)?.id || null);
    let sourceText,description;
    if (sourceKind==='character' && mode==='sprite') {
      const section=buildAppearanceSection(row,{outfits:'auto'});
      // Intentional change: the old no-section/non-throw path used display name only.
      // New explicitly requested generations use short/base fallback; legacy pixels remain unknown.
      description=String(section || '').replace(/^##\s*你的外观\s*$/m,'').replace(/^[-*]\s*/gm,'').trim()
        || row.short_prompt || row.base_prompt || row.display_name || row.name || '';
      sourceText=[`【名字】${row.display_name || row.name}`,`【外观描述（必以此为准）】${description}`].join('\n');
    } else if (sourceKind==='character') {
      description=buildPersona(row,{variant:'short',person:row.display_name || row.name});
      sourceText=[`【名字】${row.display_name || row.name}`,`【角色卡】\n${description}`].join('\n');
    } else {
      const section=buildAppearanceSection({id:characterId,base_prompt:row.persona || ''},{outfits:characterId?'auto':null});
      description=section || row.persona || row.display_name || '';
      sourceText=[`【名字】${row.display_name}`,row.job?`【职业】${row.job}（小镇居民）`:'【身份】小镇居民',
        section?`【外观（从人格卡提取，必以此为准）】\n${section}`:row.persona?`【人格卡（缺少标准外观段）】\n${row.persona}`:''].filter(Boolean).join('\n');
    }
    // Style is explicitly independent of appearance freshness. The mode and source identity
    // distinguish linked NPC art (NPC persona) from art made from a character card.
    const signature=createHash('sha256').update(JSON.stringify({version:1,sourceKind,sourceId,characterId,mode,
      createdAt:row.created_at ?? null,sourceText})).digest('hex');
    const source=Object.freeze({version:1,signature,sourceKind,sourceId,characterId,mode});
    const appearanceInfo=sourceKind==='character' && mode==='sprite'?sourceText:
      `${sourceText}\n【画风基调】${styleTags || 'cozy pixel town'}`;
    const assertCurrent=()=>{
      const current=capture({sourceKind,sourceId,mode,styleTags});
      if (current.source.signature!==signature) throw stale();
    };
    return Object.freeze({source,signature,sourceKind,sourceId,characterId,appearanceInfo,description,assertCurrent});
  }
  return {capture};
}

/** Historical or malformed provenance is unknown. Valid but different provenance is stale. */
export function townAssetAppearanceStatus(asset,captured) {
  const source=asset?.meta?.appearanceSource;
  if (!source || source.version!==1 || typeof source.signature!=='string' || !/^[a-f0-9]{64}$/.test(source.signature)
    || !['character','npc'].includes(source.sourceKind) || !Number.isSafeInteger(source.sourceId)
    || !['sprite','portrait'].includes(source.mode)) return 'unknown';
  const current=captured?.source;
  return current && ['signature','sourceKind','sourceId','characterId','mode'].every(key=>source[key]===current[key])
    ? 'current':'needs_update';
}
