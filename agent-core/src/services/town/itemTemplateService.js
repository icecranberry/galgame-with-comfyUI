import {createHash,randomUUID} from 'node:crypto';
import {canonicalJson,createTownEventService,requireText,townError} from './townEventService.js';

const digest=value=>createHash('sha256').update(canonicalJson(value)).digest('hex');
const date=ms=>new Date(ms).toISOString().slice(0,19).replace('T',' ');
const bobPayload=Object.freeze({outfit_name:'波波头发型',outfit_description:'利落波波头：齐下巴的内扣纯色短发、圆润发尾、空气刘海'});
// 允许的道具模板效果白名单：新效果必须在此显式登记，模板只能落在这几种 kind 上。
const EFFECT_KINDS=Object.freeze({mood_fix:'mood',energy:'buff',bob_cut:'hairstyle',tipsy:'buff',yukata:'outfit'});
const templateDto=r=>r && ({worldId:r.world_id,templateId:r.template_id,version:r.version,effectKey:r.effect_key,
  name:r.name,description:r.description,payload:JSON.parse(r.payload_json),rarity:r.rarity,imageUrl:r.image_url,tradable:!!r.tradable});
const itemDto=r=>r && ({id:r.id,worldId:r.world_id,ownerKey:r.owner_key,sourceType:r.source_type,sourceId:r.source_id,
  templateId:r.template_id,templateVersion:r.template_version,effectKey:r.effect_key,name:r.name,description:r.description,
  imageUrl:r.image_url,status:r.status,version:r.version,lockedBy:r.locked_by,retiredAt:r.retired_at,collectedAt:r.collected_at});

/** Purely local template metadata; grant never executes the item's effect or calls generation. */
export function createItemTemplateService({db,clock,getWorldEpoch,getActor,effectRegistry,economy=null,consumers=[]}) {
  if(!db?.transaction || !clock?.now || !getWorldEpoch || !getActor || !effectRegistry) throw townError('MISSING_DEPENDENCY');
  const events=createTownEventService({db,clock,getWorldEpoch,
    validators:{'town.item.changed':p=>typeof p?.transactionId==='string' && Array.isArray(p.itemIds)}});
  function epoch(input) {
    requireText(input.worldId);
    if(!Number.isSafeInteger(input.worldEpoch) || input.worldEpoch<1 || getWorldEpoch(input.worldId)!==input.worldEpoch) throw townError('STALE_EPOCH');
  }
  function owner(key,worldId) {
    requireText(key);
    if(key==='me') return key;
    if(key.startsWith('business:') && key.length>9) return key;
    // Delivery's existing accounts predate the item owner convention. Preserve
    // their exact keys; accept only a real business account in this world.
    if(/^delivery:business:[A-Za-z0-9_-]+$/.test(key) &&
      db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='economy_accounts'").get() &&
      db.prepare("SELECT 1 FROM economy_accounts WHERE world_id=? AND owner_key=? AND account_type='business'").get(worldId,key)) return key;
    if(key.startsWith('actor:')) {
      const id=key.slice(6),actor=getActor(id,worldId);
      if(actor && actor.actorId===id && !actor.mergedInto && actor.playerId!=='me') return key;
    }
    throw townError('INVALID_ITEM_OWNER');
  }
  function getTemplate(input) {
    epoch(input);
    return templateDto(db.prepare('SELECT * FROM item_templates WHERE world_id=? AND template_id=? AND version=?')
      .get(input.worldId,input.templateId,input.templateVersion??input.version))??null;
  }
  function validateTemplate(input) {
    requireText(input.templateId);
    if(!Number.isSafeInteger(input.version) || input.version<1) throw townError('INVALID_TEMPLATE_VERSION');
    const effect=Object.hasOwn(effectRegistry,input.effectKey)?effectRegistry[input.effectKey]:null;
    // Additional existing effects require a deliberate local whitelist entry;
    // merely appearing in ITEM_EFFECTS does not authorize arbitrary template payloads.
    const bob=input.effectKey==='bob_cut', expectedKind=EFFECT_KINDS[input.effectKey];
    if(input.templateId==='town.bob_cut' && !bob) throw townError('UNSUPPORTED_TEMPLATE_EFFECT');
    if(!effect || !expectedKind || effect.kind!==expectedKind) throw townError('UNSUPPORTED_TEMPLATE_EFFECT');
    const payload=input.payload??{};
    if(bob && (input.templateId!=='town.bob_cut' || input.version!==1)) throw townError('UNSUPPORTED_TEMPLATE_EFFECT');
    if(canonicalJson(payload)!==canonicalJson(bob?bobPayload:{})) throw townError('INVALID_TEMPLATE_PAYLOAD');
    requireText(input.name);
    if(input.name.length>80 || typeof input.description!=='string' || input.description.length<1 || input.description.length>1000) throw townError('INVALID_TEMPLATE_TEXT');
    const rarity=input.rarity??'common';
    if(!['common','uncommon','rare','epic'].includes(rarity) || typeof input.tradable!=='boolean') throw townError('INVALID_TEMPLATE');
    if(input.imageUrl!=null && (typeof input.imageUrl!=='string' || !input.imageUrl.startsWith('/') || input.imageUrl.startsWith('//') || input.imageUrl.includes('..'))) throw townError('INVALID_TEMPLATE_IMAGE');
    return {worldId:input.worldId,templateId:input.templateId,version:input.version,effectKey:input.effectKey,
      name:input.name,description:input.description,payload,rarity,imageUrl:input.imageUrl??null,tradable:input.tradable};
  }
  function publishTemplate(input) {
    return db.transaction(()=>{
      epoch(input); const t=validateTemplate(input),existing=getTemplate(input);
      if(existing) {
        if(canonicalJson(existing)!==canonicalJson(t)) throw townError('TEMPLATE_VERSION_CONFLICT');
        return existing;
      }
      db.prepare('INSERT INTO item_templates VALUES(?,?,?,?,?,?,?,?,?,?)')
        .run(t.worldId,t.templateId,t.version,t.effectKey,t.name,t.description,canonicalJson(t.payload),t.rarity,t.imageUrl,Number(t.tradable));
      return t;
    }).immediate();
  }
  function ensureDefaultTemplates(input) {
    return db.transaction(()=>[
      publishTemplate({...input,templateId:'town.mood_patch',version:1,effectKey:'mood_fix',name:'心情修复贴',
        description:'一枚暖色的小贴纸。使用后让一位角色的心情恢复开心，立即生效。',tradable:true}),
      publishTemplate({...input,templateId:'town.energy_charm',version:1,effectKey:'energy',name:'元气挂饰',
        description:'一枚轻巧的元气挂饰。使用后让一位角色精神饱满，效果沿用原元气符咒。',tradable:true}),
    ]).immediate();
  }
  /** 功能建筑的本地产出模板（不调用模型）：只发布注册表声明过的商品。 */
  function ensureVenueTemplates(input,products) {
    if(!Array.isArray(products))throw townError('INVALID_TEMPLATE');
    return db.transaction(()=>products.map(product=>publishTemplate({...input,templateId:product.templateId,
      version:product.templateVersion,effectKey:product.effectKey,name:product.name,description:product.description,
      tradable:true}))).immediate();
  }
  function ensureBobCutTemplate(input) {
    return publishTemplate({...input,templateId:'town.bob_cut',version:1,effectKey:'bob_cut',
      name:'波波头发型卡',description:'一张波波头发型卡。交入背包后，手动使用可让一位角色换上波波头发型，持续24小时。',
      payload:bobPayload,tradable:true});
  }
  function execute(command,input,body) {
    return db.transaction(()=>{
      epoch(input); requireText(input.idempotencyKey);requireText(input.sourceKey);requireText(input.reasonCode);
      if(input.sourceEventId!=null)requireText(input.sourceEventId);
      const {worldEpoch,...request}=input;
      const {idempotencyKey,expectedVersion,expectedAccountVersion,...semantic}=request;
      const requestHash=digest({command,input:request}),sourceHash=digest({command,input:semantic});
      const previous=db.prepare(`SELECT r.request_hash,t.response FROM town_item_requests r JOIN town_item_transactions t USING(transaction_id)
        WHERE r.world_id=? AND r.request_key=?`).get(input.worldId,input.idempotencyKey);
      if(previous) {
        if(previous.request_hash!==requestHash)throw townError('IDEMPOTENCY_CONFLICT');
        return JSON.parse(previous.response);
      }
      const sourced=db.prepare('SELECT * FROM town_item_transactions WHERE world_id=? AND source_key=?').get(input.worldId,input.sourceKey);
      if(sourced) {
        if(sourced.request_hash!==sourceHash)throw townError('SOURCE_CONFLICT');
        db.prepare('INSERT INTO town_item_requests VALUES(?,?,?,?)').run(input.worldId,input.idempotencyKey,requestHash,sourced.transaction_id);
        return JSON.parse(sourced.response);
      }
      const transactionId=randomUUID(),eventId=`item:${transactionId}`;
      const result={transactionId,eventId,...body()};
      const now=clock.now();
      if(!Number.isSafeInteger(now) || now<0)throw townError('INVALID_TIME');
      db.prepare('INSERT INTO town_item_transactions VALUES(?,?,?,?,?,?,?,?,?)')
        .run(transactionId,input.worldId,input.worldEpoch,input.sourceKey,sourceHash,command,input.reasonCode,now,canonicalJson(result));
      events.append({eventId,worldId:input.worldId,worldEpoch:input.worldEpoch,type:'town.item.changed',occurredAt:now,
        source:{system:'town.items',entityId:transactionId},
        payload:{transactionId,command,itemIds:result.itemIds,reasonCode:input.reasonCode,sourceEventId:input.sourceEventId??null}},consumers);
      db.prepare('INSERT INTO town_item_requests VALUES(?,?,?,?)').run(input.worldId,input.idempotencyKey,requestHash,transactionId);
      return result;
    }).immediate();
  }
  function grant(input) {
    requireText(input.sourceId);
    return execute('grant',{...input,sourceKey:`grant:${digest({sourceType:input.sourceType,sourceId:input.sourceId})}`},()=>{
      owner(input.ownerKey,input.worldId);
      if(!['service','production','reward','seed'].includes(input.sourceType))throw townError('INVALID_GRANT_SOURCE');
      if(!Number.isSafeInteger(input.quantity) || input.quantity<1 || input.quantity>20)throw townError('INVALID_QUANTITY');
      const template=getTemplate(input);
      if(!template)throw townError('TEMPLATE_NOT_FOUND');
      validateTemplate(template);
      const now=date(clock.now()),itemIds=[];
      for(let i=0;i<input.quantity;i++) {
        const inserted=db.prepare(`INSERT INTO backpack_items(effect_key,name,description,rarity,image_url,status,payload_json,
          owner_key,source_type,world_id,source_id,source_index,template_id,template_version,collected_at,acquired_at)
          VALUES(?,?,?,?,?,'ready',?,?,?,?,?,?,?,?,?,?)`)
          .run(template.effectKey,template.name,template.description,template.rarity,template.imageUrl,canonicalJson(template.payload),
            input.ownerKey,input.sourceType,input.worldId,input.sourceId,i,template.templateId,template.version,input.ownerKey==='me'?now:null,now);
        itemIds.push(Number(inserted.lastInsertRowid));
      }
      return {itemIds,items:itemIds.map(id=>itemDto(db.prepare('SELECT * FROM backpack_items WHERE id=?').get(id)))};
    });
  }
  function current(input) {
    owner(input.ownerKey,input.worldId);
    if(!Number.isSafeInteger(input.itemId) || input.itemId<1)throw townError('INVALID_ITEM_ID');
    const item=db.prepare('SELECT * FROM backpack_items WHERE id=? AND world_id=? AND owner_key=?')
      .get(input.itemId,input.worldId,input.ownerKey);
    if(!item)throw townError('ITEM_NOT_FOUND');
    if(!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion!==item.version)throw townError('VERSION_CONFLICT');
    if(item.retired_at!==null || item.status!=='ready' || (item.owner_key==='me' && !item.collected_at))throw townError('ITEM_UNAVAILABLE');
    if(db.prepare('SELECT 1 FROM item_effects WHERE item_id=?').get(item.id))throw townError('ITEM_HAS_EFFECT');
    return item;
  }
  function matchingLock(item,input) {
    if((input.lockKey??null)!==item.locked_by)throw townError('ITEM_LOCKED');
  }
  function movable(item,input) {
    matchingLock(item,input);
    const template=getTemplate({worldId:input.worldId,worldEpoch:input.worldEpoch,templateId:item.template_id,templateVersion:item.template_version});
    if(!template?.tradable || ['legacy_chest','chest'].includes(item.source_type))throw townError('ITEM_NOT_TRADABLE');
  }
  function updatedResult(id) {return {itemIds:[id],items:[itemDto(db.prepare('SELECT * FROM backpack_items WHERE id=?').get(id))]};}
  function transferItem(input,item=current(input)) {
    movable(item,input);owner(input.toOwnerKey,input.worldId);
    if(input.ownerKey===input.toOwnerKey)throw townError('SAME_OWNER');
    const changed=db.prepare(`UPDATE backpack_items SET owner_key=?,collected_at=?,locked_by=NULL,version=version+1
      WHERE id=? AND version=? AND owner_key=? AND locked_by IS ? AND retired_at IS NULL AND status='ready'`)
      .run(input.toOwnerKey,input.toOwnerKey==='me'?date(clock.now()):null,item.id,item.version,item.owner_key,item.locked_by);
    if(changed.changes!==1)throw townError('VERSION_CONFLICT');
    return updatedResult(item.id);
  }
  function lock(input) {
    return execute('lock',input,()=>{
      const item=current(input);requireText(input.lockKey);
      if(item.locked_by!==null)throw townError('ITEM_LOCKED');
      const changed=db.prepare(`UPDATE backpack_items SET locked_by=?,version=version+1 WHERE id=? AND version=? AND locked_by IS NULL AND retired_at IS NULL`)
        .run(input.lockKey,item.id,item.version);
      if(changed.changes!==1)throw townError('VERSION_CONFLICT');
      return updatedResult(item.id);
    });
  }
  function unlock(input) {
    return execute('unlock',input,()=>{
      const item=current(input); requireText(input.lockKey);matchingLock(item,input);
      const changed=db.prepare('UPDATE backpack_items SET locked_by=NULL,version=version+1 WHERE id=? AND version=? AND locked_by=?')
        .run(item.id,item.version,input.lockKey);
      if(changed.changes!==1)throw townError('VERSION_CONFLICT');
      return updatedResult(item.id);
    });
  }
  function retire(input) {
    return execute('retire',input,()=>{
      const item=current(input);matchingLock(item,input);
      const changed=db.prepare('UPDATE backpack_items SET retired_at=?,locked_by=NULL,version=version+1 WHERE id=? AND version=? AND locked_by IS ?')
        .run(date(clock.now()),item.id,item.version,item.locked_by);
      if(changed.changes!==1)throw townError('VERSION_CONFLICT');
      return updatedResult(item.id);
    });
  }
  function paysFor(account,ownerKey,worldId) {
    if(ownerKey==='me')return account.accountType==='actor' && getActor(account.actorId,worldId)?.playerId==='me';
    return account.ownerKey===ownerKey && account.accountType!=='issuance';
  }
  function trade(input) {
    return execute('trade',input,()=>{
      if(!economy)throw townError('ECONOMY_REQUIRED');
      const item=current(input);movable(item,input);owner(input.toOwnerKey,input.worldId);
      const from=economy.getAccount({worldId:input.worldId,worldEpoch:input.worldEpoch,accountId:input.fromAccountId});
      const to=economy.getAccount({worldId:input.worldId,worldEpoch:input.worldEpoch,accountId:input.toAccountId});
      if(!paysFor(from,input.toOwnerKey,input.worldId) || !paysFor(to,input.ownerKey,input.worldId))throw townError('ACCOUNT_OWNER_MISMATCH');
      const payment=economy.transfer({worldId:input.worldId,worldEpoch:input.worldEpoch,fromAccountId:from.accountId,toAccountId:to.accountId,
        amount:input.amount,...(input.expectedAccountVersion===undefined?{}:{expectedVersion:input.expectedAccountVersion}),
        idempotencyKey:`item-payment:${digest({key:input.idempotencyKey})}`,
        sourceKey:`item-payment:${digest({key:input.sourceKey})}`,reasonCode:input.reasonCode});
      return {...transferItem(input,item),payment};
    });
  }
  function releaseLocks(input) {
    return execute('releaseLocks',input,()=>{
      const rows=db.prepare('SELECT id,version,locked_by FROM backpack_items WHERE world_id=? AND locked_by IS NOT NULL AND retired_at IS NULL ORDER BY id').all(input.worldId);
      for(const row of rows) {
        const change=db.prepare('UPDATE backpack_items SET locked_by=NULL,version=version+1 WHERE id=? AND version=? AND locked_by=?')
          .run(row.id,row.version,row.locked_by);
        if(change.changes!==1)throw townError('VERSION_CONFLICT');
      }
      return {itemIds:rows.map(r=>r.id),items:rows.map(r=>itemDto(db.prepare('SELECT * FROM backpack_items WHERE id=?').get(r.id)))};
    });
  }
  return {publishTemplate,getTemplate,ensureDefaultTemplates,ensureBobCutTemplate,ensureVenueTemplates,grant,lock,unlock,retire,trade,releaseLocks,events,
    transfer:input=>execute('transfer',input,()=>transferItem(input)),
    getItem:input=>{epoch(input);return itemDto(db.prepare('SELECT * FROM backpack_items WHERE id=? AND world_id=?').get(input.itemId,input.worldId))??null;},
    flushNotifications:(receipt,broadcast)=>{
      if(db.inTransaction)throw townError('COMMIT_REQUIRED');
      const row=db.prepare('SELECT * FROM town_item_transactions WHERE transaction_id=?').get(receipt.transactionId);
      if(!row)throw townError('TRANSACTION_NOT_COMMITTED');
      epoch({worldId:row.world_id,worldEpoch:row.world_epoch});
      const actual=JSON.parse(row.response);
      if(actual.eventId!==receipt.eventId)throw townError('INVALID_RECEIPT');
      return broadcast(events.get(actual.eventId));
    },
  };
}
