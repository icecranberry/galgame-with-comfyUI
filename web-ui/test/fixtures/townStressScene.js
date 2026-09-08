// Reuse the M1/M7 synthetic silhouettes; no generated or production assets.
export const syntheticAssets = {
  'grass.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="32"><path d="M32 0L64 16L32 32L0 16Z" fill="#8daf6c" stroke="#f5f4ee"/></svg>',
  'road.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="32"><path d="M32 0L64 16L32 32L0 16Z" fill="#c9b490" stroke="#f5f4ee"/></svg>',
  'card.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="96"><path d="M8 38L32 10L56 38V92H8Z" fill="#b78d6b"/><path d="M4 38L32 4L60 38Z" fill="#855645"/><path d="M25 66H39V92H25Z" fill="#504839"/></svg>',
  'person.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="96"><circle cx="32" cy="18" r="12" fill="#b47d53"/><path d="M20 30H44L49 70H40V94H32V70H25V94H16Z" fill="#566b56"/></svg>',
}
export function createStressScene(count = 50) {
  const path = name => `/stress-assets/${name}.svg`
  const assets = [
    {id:1,kind:'ground',imagePath:path('grass'),meta:{}},
    {id:2,kind:'road',imagePath:path('road'),meta:{}},
    {id:3,kind:'building',imagePath:path('card'),meta:{footprint:{w:3,h:2}}},
    {id:4,kind:'prop',imagePath:path('card'),meta:{}},
    ...['cafe','workshop','notice_station'].map((buildingProfile,i)=>({id:5+i,kind:'building',imagePath:path('card'),meta:{projection:'modular_volume',modularVolumeVersion:1,buildingProfile,footprint:{w:3,h:3},doorOffset:{dx:1,dy:2}}})),
  ]
  const objects = Array.from({length:77},(_,i)=>({id:`legacy:${i}`,assetId:i<45?3:4,x:1+(i%10)*5,y:4+Math.floor(i/10)*6}))
  objects.push(...[5,6,7].map((assetId,i)=>({id:`volume:${i}`,assetId,x:17+i*5,y:25})))
  const map = {cols:50,rows:50,assets,layers:{
    ground:Array.from({length:50},()=>Array(50).fill(1)),
    road:Array.from({length:50},(_,y)=>Array.from({length:50},(_,x)=>y%6===1||x%5===0?2:null)),
    objects,blockOverride:[],
  }}
  const agents = Array.from({length:count},(_,i)=>({agentKey:`resident:${i}`,kind:i%3===0?'char':'npc',characterId:i%3===0||i%3===1?i+1:null,npcId:i%3!==0?i+101:null,displayName:`居民${i+1}`,x:2+(i%10)*4.5,y:7+Math.floor(i/10)*6,
    ...(i===count-1?{}:{sprites:{down:path('person'),up:path('person')}}),
  }))
  return {map,agents}
}
