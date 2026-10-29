import test from 'node:test'
import assert from 'node:assert/strict'
import {TOUCH_LABELS,TOUCH_ZONES,touchPartAt,createTouchReplyEngine} from '../src/utils/standingTouch.js'
import {TOUCH_PARTS} from '../../agent-core/src/services/standingTouchLines.js'
test('all ten parts match the generated schema; default zones survive large padding',()=>{
 assert.deepEqual(Object.keys(TOUCH_LABELS),Object.keys(TOUCH_PARTS))
 assert.equal(TOUCH_LABELS.butt,'臀侧');assert.equal(TOUCH_PARTS.butt,'屁股和下体')
 assert.equal(TOUCH_LABELS.chest,'胸口');assert.equal(TOUCH_PARTS.chest,'胸部和乳房')
 for(const b of [{x:0,y:0,width:400,height:800,imageWidth:400,imageHeight:800},{x:300,y:200,width:400,height:800,imageWidth:1400,imageHeight:1600}]){
  const p=(x,y)=>({x:(b.x+x*b.width)/b.imageWidth,y:(b.y+y*b.height)/b.imageHeight})
  for(const z of TOUCH_ZONES)assert.equal(touchPartAt(p(z.x+z.w/2,z.y+z.h/2),b),z.part)
  for(let y=.001;y<1;y+=.019)for(let x=.001;x<1;x+=.037)assert.ok(touchPartAt(p(x,y),b),'no gaps in broad touch map')
  assert.equal(touchPartAt(p(-.01,.5),b),null);assert.equal(touchPartAt(p(.5,1.01),b),null)
 }
})
test('every valid touch immediately selects the latest line without waiting for the previous reply',()=>{
 let time=0;const e=createTouchReplyEngine({now:()=>time,random:()=>0})
 const lines={head:['第一句专属台词','第二句专属台词','第三句专属台词']}
 assert.equal(e.act('head',lines).text,lines.head[0]);assert.equal(e.act('head',lines).text,lines.head[1])
 time+=10;assert.equal(e.act('head',lines).text,lines.head[0]);time+=10;assert.equal(e.act('head',lines).text,lines.head[1])
 time+=650;assert.match(e.act('foot',null).text,/脚/);assert.equal(e.act('invalid',lines),null)
 e.reset();assert.equal(e.act('head',lines).text,lines.head[0])
})
