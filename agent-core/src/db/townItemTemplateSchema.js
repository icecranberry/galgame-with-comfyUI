import {migrateTownItemSchema} from './townItemSchema.js';

/** Call after backpack_items creation and before item lifecycle/startup cleanup. */
export function migrateTownItemTemplateSchema(db) {
  return db.transaction(()=>{
    migrateTownItemSchema(db);
    const columns=new Set(db.prepare('PRAGMA table_info(backpack_items)').all().map(c=>c.name));
    for(const [name,ddl] of Object.entries({
      template_id:'TEXT',template_version:'INTEGER',world_id:'TEXT',source_id:'TEXT',source_index:'INTEGER',
      version:'INTEGER NOT NULL DEFAULT 1 CHECK(version>=1)',locked_by:'TEXT',retired_at:'DATETIME',
    })) if(!columns.has(name)) db.exec(`ALTER TABLE backpack_items ADD COLUMN ${name} ${ddl}`);
    db.exec(`
      CREATE TABLE IF NOT EXISTS town_item_template_schema(singleton INTEGER PRIMARY KEY CHECK(singleton=1),version INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS item_templates (
        world_id TEXT NOT NULL,template_id TEXT NOT NULL,version INTEGER NOT NULL CHECK(version>=1),
        effect_key TEXT NOT NULL,name TEXT NOT NULL,description TEXT NOT NULL,payload_json TEXT NOT NULL,
        rarity TEXT NOT NULL,image_url TEXT,tradable INTEGER NOT NULL CHECK(tradable IN (0,1)),
        PRIMARY KEY(world_id,template_id,version)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS town_items_grant_source ON backpack_items(world_id,source_type,source_id,source_index)
        WHERE source_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS town_items_owner_template ON backpack_items(owner_key,template_id,status,retired_at);
      CREATE TABLE IF NOT EXISTS town_item_transactions (
        transaction_id TEXT PRIMARY KEY,world_id TEXT NOT NULL,world_epoch INTEGER NOT NULL,
        source_key TEXT NOT NULL,request_hash TEXT NOT NULL,command TEXT NOT NULL,reason_code TEXT NOT NULL,
        occurred_at INTEGER NOT NULL,response TEXT NOT NULL,UNIQUE(world_id,source_key)
      );
      CREATE TABLE IF NOT EXISTS town_item_requests (
        world_id TEXT NOT NULL,request_key TEXT NOT NULL,request_hash TEXT NOT NULL,
        transaction_id TEXT NOT NULL REFERENCES town_item_transactions(transaction_id),PRIMARY KEY(world_id,request_key)
      );
    `);
    for(const [table,fields] of Object.entries({
      item_templates:['world_id','template_id','version','effect_key','name','description','payload_json','rarity','image_url','tradable'],
      town_item_transactions:['transaction_id','world_id','world_epoch','source_key','request_hash','command','reason_code','occurred_at','response'],
      town_item_requests:['world_id','request_key','request_hash','transaction_id'],
    })) {
      const cols=new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(c=>c.name));
      if(fields.some(f=>!cols.has(f))) throw new Error(`Incompatible ${table} schema`);
    }
    const existing=db.prepare('SELECT version FROM town_item_template_schema WHERE singleton=1').get();
    if(existing && existing.version!==1) throw new Error('Unsupported item template schema version');
    for(const table of ['item_templates','town_item_transactions','town_item_requests']) for(const op of ['UPDATE','DELETE'])
      db.exec(`CREATE TRIGGER IF NOT EXISTS ${table}_immutable_${op.toLowerCase()} BEFORE ${op} ON ${table}
        BEGIN SELECT RAISE(ABORT,'Immutable item record'); END`);
    db.prepare('INSERT OR IGNORE INTO town_item_template_schema VALUES(1,1)').run();
    return {version:1};
  }).immediate();
}
