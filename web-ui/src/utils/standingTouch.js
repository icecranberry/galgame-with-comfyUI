export const TOUCH_LABELS = { head:'头顶',face:'脸',shoulder:'肩颈',hand:'手',chest:'胸口',belly:'肚子',butt:'臀侧',thigh:'大腿',calf:'小腿',foot:'脚' }
// Broad adjacent zones, relative to visible character bounds rather than image padding.
const rect=(part,x,y,w,h)=>({part,x,y,w,h})
export const TOUCH_ZONES=[
  rect('head',0,0,1,.075),rect('face',0,.075,1,.09),
  rect('shoulder',0,.165,1,.065),
  rect('hand',0,.23,.24,.35),rect('hand',.76,.23,.24,.35),
  rect('chest',.24,.23,.52,.12),rect('belly',.24,.35,.52,.12),
  rect('butt',.24,.47,.52,.11),rect('thigh',0,.58,1,.19),
  rect('calf',0,.77,1,.16),rect('foot',0,.93,1,.07),
]
export function touchPartAt(point,bounds){
  if(!point||!bounds?.width||!bounds?.height)return null
  const x=(point.x*bounds.imageWidth-bounds.x)/bounds.width,y=(point.y*bounds.imageHeight-bounds.y)/bounds.height
  if(x<0||x>1||y<0||y>1)return null
  return TOUCH_ZONES.find(z=>x>=z.x&&x<=z.x+z.w&&y>=z.y&&y<=z.y+z.h)?.part||null
}
export function createTouchReplyEngine({now=()=>performance.now(),random=Math.random}={}){
  const previous={}
  return {
    reset(){Object.keys(previous).forEach(k=>delete previous[k])},
    act(part,lines){
      // Each completed gesture replaces the previous reply, even during speech.
      // The hit layer already rejects cancelled/invalid gestures; never queue or
      // throttle a newer valid touch behind the previous line.
      if(!TOUCH_LABELS[part])return null
      const all=Array.isArray(lines?.[part])?lines[part].filter(s=>typeof s==='string'&&s.trim()):[]
      const alternatives=all.filter(s=>s!==previous[part])
      const pool=alternatives.length?alternatives:all
      const text=pool.length?pool[Math.min(pool.length-1,Math.floor(Math.max(0,random())*pool.length))]:`轻轻碰了碰${TOUCH_LABELS[part]}。`
      previous[part]=text
      return {text,part,motion:['head','hand','shoulder'].includes(part)?'pat':'poke',amplitude:.4,variant:Math.floor(random()*3),id:now()}
    },
  }
}
