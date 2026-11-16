// Photo studio frames: catalog, compatibility, layout and drawing.
const COMIC_FRAMES = [
  ['mangaburst', '黑白爆格', '#fff8e7', [.22, .22, .27]],
  ['heroimpact', '英雄冲击', '#ffe340', [.23, .2, .3]],
  ['shojobloom', '少女花页', '#ffd5e4', [.19, .21, .24]],
  ['brokenpanels', '破格分镜', '#f9f5e9', [.2, .24, .28]],
  ['inkslash', '墨刃切边', '#191824', [.2, .19, .23]],
  ['tornzine', '独立志撕贴', '#f3ecce', [.2, .23, .26]],
  ['roughsketch', '毛边速写', '#f5ead1', [.16, .16, .21]],
  ['speechcut', '对白气泡', '#ffed61', [.16, .17, .3]],
  ['thoughtcut', '云形独白', '#e2dcfa', [.2, .21, .28]],
  ['speedribbon', '疾速飘带', '#f76437', [.22, .2, .27]],
  ['halftoneteeth', '网点锯齿', '#f7cbe1', [.2, .2, .24]],
  ['misregister', '错版裁片', '#65d9db', [.2, .2, .25]],
  ['foldcorner', '折角画稿', '#f1e3bd', [.17, .19, .23]],
  ['paintspill', '泼墨剪边', '#a89cfc', [.23, .23, .27]],
  ['graffiticut', '涂写剪贴', '#d5f253', [.21, .23, .28]],
  ['zigzagcut', '闪电裂口', '#ffe750', [.2, .21, .26]],
  ['contourcut', '波浪模切', '#f5a2b7', [.2, .22, .25]],
].map(([value, label, paper, margins]) => ({ value, label, paper, margins }))
const comicFrameIds = new Set(COMIC_FRAMES.map(item => item.value))

const RETIRED_FRAME_IDS = ['origami', 'botanical', 'sakura', 'celestial', 'deco', 'baroque', 'denim', 'leather', 'kraft', 'cork', 'marble', 'porcelain', 'racing', 'sunburst', 'ribbon', 'snow', 'fire', 'cloud', 'laser', 'inflatable', 'cassette', 'filmweave', 'zipbag', 'binder', 'ticketwall', 'acrylic', 'accordion', 'comicpanels', 'puzzle', 'pool', 'matchbox', 'screenprint', 'pixelblocks', 'velvetstage', 'portal', 'stickerbomb']
const SPECIAL_FRAME_PRESETS = [
  ['terrazzo', '水磨石粉彩', '#f0e8df', [.12, .12, .12]],
  ['handheld', '掌机存档', '#c8b5ef', [.17, .18, .38]],
  ['editorial', '巨字封面', '#ee492e', [.11, .24, .2]],
].map(([value, label, paper, margins]) => ({ value, label, paper, margins })).concat(COMIC_FRAMES)
const specialFrameMargins = Object.fromEntries(SPECIAL_FRAME_PRESETS.map(item => [item.value, item.margins]))
const specialFramePapers = Object.fromEntries(SPECIAL_FRAME_PRESETS.map(item => [item.value, item.paper]))

export const STUDIO_FRAMES = [
  { value: 'classic', label: '经典白边' },
  { value: 'none', label: '无相框' },
  { value: 'white', label: '厂牌白边' },
  { value: 'ticket', label: '演出票根' },
  { value: 'polaroid', label: '徕卡拍立得' },
  { value: 'aged', label: '撕裂档案' },
  { value: 'journal', label: '拼贴手账' },
  { value: 'gallery', label: '先锋画廊' },
  { value: 'comic', label: '漫画爆炸' },
  { value: 'arcade', label: '霓虹街机' },
  { value: 'hazard', label: '工业警戒' },
  { value: 'vinyl', label: '唱片封套' },
  { value: 'riso', label: '孔版撞色' },
  { value: 'memphis', label: '孟菲斯派对' },
  { value: 'lace', label: '暗黑蕾丝' },
  { value: 'postal', label: '航空邮戳' },
  { value: 'circuit', label: '电路封装' },
  { value: 'mosaic', label: '彩玻拼窗' },
  { value: 'wave', label: '海浪浮世' },
  { value: 'zebra', label: '野性斑马' },
  { value: 'blueprint', label: '蓝图标尺' },
  { value: 'news', label: '报刊头版' },
  ...SPECIAL_FRAME_PRESETS.map(({ value, label }) => ({ value, label })),
]

const retiredFrames = new Set(RETIRED_FRAME_IDS)
export function normalizeStudioFrame(frame) { return retiredFrames.has(frame) ? 'none' : frame === 'instant' ? 'ticket' : ['film', 'chrome'].includes(frame) ? 'polaroid' : frame }
export const DEFAULT_STUDIO_CAMERA_SETTINGS = '35mm · f/2 · 1/125s · ISO 100'

// The inline Leica artwork is part of the frame implementation.
// Official Leica vector artwork, kept inline for identical browser/worker rendering.
// Source: https://leica-camera.com/themes/custom/leica_redesign_theme/logo.svg
const LEICA_LOGO_SVG = "<svg width=\"200\" height=\"200\" viewBox=\"0 0 200 200\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\">\n<g clip-path=\"url(#clip0)\">\n<path d=\"M99.9956 200C155.223 200 200 155.232 200 100.022C200 44.7855 155.223 1.52588e-05 99.9956 1.52588e-05C44.759 1.52588e-05 0 44.7855 0 100.022C0 155.232 44.759 200 99.9956 200Z\" fill=\"#E20612\"/>\n<path d=\"M67.6897 55.3426C48.8248 54.6106 43.7183 81.4131 42.5541 85.9904C42.4924 86.3167 42.3336 86.4314 42.3336 86.4314C36.5127 85.6376 33.2936 84.447 33.2936 84.447L31.9707 88.1953C35.8954 90.0562 41.6721 90.6206 41.6721 90.6206C40.5432 97.8262 34.837 111.346 34.837 111.346C34.837 111.346 29.7746 109.803 23.3717 109.803C15.046 109.803 12.118 113.719 11.9063 116.197C11.3595 122.618 19.4999 125.678 25.1356 125.678C36.1335 125.678 41.8926 119.725 41.8926 119.725C41.8926 119.725 72.6815 131.411 104.952 131.411C147.189 131.411 182.784 120.166 182.784 120.166L181.682 116.197C181.682 116.197 155.885 125.184 106.496 124.576C72.4258 124.161 46.3024 114.213 46.3024 114.213C46.3024 114.213 47.2902 112.449 47.8458 111.346C51.2589 104.388 55.3424 90.4001 55.3424 90.4001C55.3424 90.4001 78.7141 83.8561 78.7141 65.2645C78.7141 59.3819 73.0961 55.5807 67.6897 55.3426ZM68.5716 60.6343C72.1965 60.6343 73.5018 63.5006 73.2019 66.1465C71.438 81.6776 56.0038 85.3289 56.0038 85.3289C56.0038 85.3289 59.7345 60.6343 68.5716 60.6343ZM106.055 73.4226C102.13 73.4226 99.4399 75.0366 99.4399 78.7143C99.4399 82.4361 102.58 83.3445 106.055 83.3445C109.538 83.3445 112.89 81.8452 112.89 78.0528C112.89 74.2516 108.894 73.4226 106.055 73.4226ZM158.31 86.8723C147.039 86.8723 140.936 96.5914 140.671 102.306C140.618 103.55 140.451 103.629 140.451 103.629C140.186 103.929 136.305 108.48 131.411 108.48C127.495 108.48 126.78 105.287 126.78 103.188C126.78 100.913 128.721 91.9436 134.057 91.9436C136.958 91.9436 138.687 94.3689 138.687 94.3689L140.23 89.2977C140.23 89.2977 137.796 87.331 132.734 87.3133C121.833 87.3045 114.477 95.3743 114.213 102.747C114.16 103.85 113.974 104.22 113.992 104.291C113.631 104.732 111.082 107.819 107.598 107.819C105.217 107.819 105.173 105.993 105.173 105.173C105.173 104.053 109.803 87.9748 109.803 87.9748L97.4555 88.1953L93.2663 103.85C93.2663 103.85 86.3871 108.692 76.9502 109.362C72.0818 109.697 70.3355 106.69 70.3355 104.952C70.3356 104.229 70.3355 104.291 70.3355 104.291C70.3444 104.291 72.3817 104.511 73.8634 104.511C75.0275 104.511 89.518 103.391 89.518 94.5894C89.518 89.5535 84.4115 87.7543 78.0526 87.7543C66.2962 87.7543 57.9882 94.9775 57.9882 103.629C57.9882 111.523 64.7263 114.874 73.4224 114.874C83.2914 114.874 93.0458 108.921 93.0458 108.921C93.0458 108.921 93.6367 114.874 101.424 114.874C109.459 114.874 115.756 108.921 115.756 108.921C115.756 108.921 119.231 114.654 127.221 114.654C135.388 114.654 141.553 108.039 141.553 108.039C141.553 108.039 143.829 114.213 151.916 114.213C158.24 114.213 161.617 110.244 161.617 110.244C161.617 110.244 163.381 114.213 168.894 114.213C175.623 114.213 180.579 109.583 180.579 109.583L179.477 105.614C179.477 105.614 176.919 107.598 175.067 107.598C173.665 107.598 172.862 106.46 172.862 105.173C172.862 102.28 177.493 87.9748 177.493 87.9748L166.248 88.1953L165.807 89.9592C165.807 89.9592 164.131 86.8723 158.31 86.8723ZM78.4936 91.2821C80.1517 91.3791 81.4129 92.4992 81.3599 93.7075C81.0865 101.539 71.438 100.322 71.438 100.322C71.438 100.322 72.8579 90.9381 78.4936 91.2821ZM160.515 91.5026C162.835 91.5026 164.043 93.3459 164.043 94.8099C164.043 95.1098 162.729 108.48 156.105 108.48C153.071 108.48 153.018 105.032 153.018 104.07C153.018 101.522 155.02 91.5026 160.515 91.5026ZM21.1668 114.654C21.7427 114.596 22.2097 114.619 22.7102 114.654C27.5345 114.918 31.7502 116.638 31.7502 116.638C31.7502 116.638 26.7848 120.483 22.7102 120.607C19.5969 120.704 17.639 118.675 17.639 117.52C17.639 115.602 19.4391 114.828 21.1668 114.654Z\" fill=\"white\"/>\n</g>\n<defs>\n<clipPath id=\"clip0\">\n<rect width=\"200\" height=\"200\" fill=\"white\"/>\n</clipPath>\n</defs>\n</svg>"

const shapes = [...LEICA_LOGO_SVG.matchAll(/<path\s+d="([^"]+)"\s+fill="([^"]+)"/g)].map(match => ({ data: match[1], fill: match[2] }))
const cache = new WeakMap()
function drawLeicaLogo(ctx, x, y, size, createPath) {
  let paths = cache.get(createPath)
  if (!paths) { paths = shapes.map(shape => ({ path: createPath(shape.data), fill: shape.fill })); cache.set(createPath, paths) }
  ctx.save(); ctx.translate(x, y); ctx.scale(size / 200, size / 200)
  for (const shape of paths) { ctx.fillStyle = shape.fill; ctx.fill(shape.path) }
  ctx.restore()
}

function drawComicFrame(ctx, recipe, { x, y, w, h, W, H, s, bottom }, { noise, inkText }) {
  if (!comicFrameIds.has(recipe.frame)) return
  // Cut-paper background; comic compositions place masked photo panels above it.
  ctx.clearRect(0, 0, W, H)
  const ink = '#242031', cream = '#fff7df'
  const path = points => { ctx.beginPath(); points.forEach(([a, b], i) => i ? ctx.lineTo(a, b) : ctx.moveTo(a, b)); ctx.closePath() }
  const polygon = (points, color, outline = null, thickness = .009) => { path(points); ctx.fillStyle = color; ctx.fill(); if (outline) { ctx.strokeStyle = outline; ctx.lineWidth = s * thickness; ctx.lineJoin = 'round'; ctx.stroke() } }
  const line = (ax, ay, bx, by, color = ink, thickness = .004) => { ctx.strokeStyle = color; ctx.lineWidth = Math.max(.5, s * thickness); ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke() }
  const circle = (cx, cy, radius, color) => { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.fill() }
  const text = (label, cx, cy, size, color = ink, angle = 0, max = W) => {
    if (recipe.photoComposition && ['BOOM!', 'GO! GO!', 'POP!', 'ZAP!'].includes(label)) return
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(angle); inkText(ctx, label, 0, 0, size, color, 'center', max); ctx.restore()
  }
  const inset = (points, amount) => points.map(([px, py]) => [px + (px < W / 2 ? amount : -amount), py + (py < H / 2 ? amount : -amount)])
  const shell = (points, color, draw, outline = ink) => {
    polygon(points, color, outline)
    ctx.save(); path(points); ctx.clip(); draw?.(); ctx.restore()
  }
  const irregular = (mode, seed = 0) => {
    const points = [], horizontal = mode === 'torn' ? 45 : mode === 'wave' ? 100 : 16, vertical = Math.round(horizontal * H / W)
    const amount = (i, count, side) => {
      if (mode === 'burst') return i % 2 ? .57 + noise(i + seed, side) * .12 : .035
      if (mode === 'wave') return .15 + (.5 + .5 * Math.sin(i / count * Math.PI * 12 + side)) * .22
      return .06 + noise(i + seed, side) * (mode === 'torn' ? .24 : .5)
    }
    // Join inset edge spans diagonally: no crossing loops at the four corners.
    for (let i = 0; i <= horizontal; i++) points.push([x * .35 + (W - x * .7) * i / horizontal, y * amount(i, horizontal, 11)])
    for (let i = 0; i <= vertical; i++) points.push([W - x * amount(i, vertical, 22), y * .35 + (H - y * .35 - bottom * .35) * i / vertical])
    for (let i = horizontal; i >= 0; i--) points.push([x * .35 + (W - x * .7) * i / horizontal, H - bottom * amount(i, horizontal, 33)])
    for (let i = vertical; i >= 0; i--) points.push([x * amount(i, vertical, 44), y * .35 + (H - y * .35 - bottom * .35) * i / vertical])
    return points
  }
  const rays = (color, count = 70, thick = .003) => {
    for (let i = 0; i < count; i++) {
      const a = i * Math.PI * 2 / count, cx = W * .5, cy = H * .47
      line(cx + Math.cos(a) * s * .45, cy + Math.sin(a) * s * .45, cx + Math.cos(a) * H * 1.5, cy + Math.sin(a) * H * 1.5, color, thick * (i % 3 ? 1 : 2.8))
    }
  }
  const dots = (color, step = .024, radius = .004) => {
    for (let j = 0, cy = 0; cy < H; j++, cy += s * step) for (let cx = (j % 2) * s * step / 2; cx < W; cx += s * step) circle(cx, cy, s * radius, color)
  }
  const star = (cx, cy, radius, color, points = 8) => polygon(Array.from({ length: points * 2 }, (_, i) => { const a = i * Math.PI / points; const r = radius * (i % 2 ? .43 : 1); return [cx + Math.cos(a) * r, cy + Math.sin(a) * r] }), color, ink, .003)
  const panel = (points, color, label, cx, cy, size, angle = 0) => { polygon(points, color, ink, .007); if (label) text(label, cx, cy, size, ink, angle) }
  switch (recipe.frame) {
    case 'mangaburst': {
      shell(irregular('burst'), cream, () => rays(ink, 84, .0025))
      const p = [[W * .21, H - bottom * .77], [W * .74, H - bottom * .9], [W * .85, H - bottom * .2], [W * .17, H - bottom * .1]]
      panel(p, cream, 'SNAP!!', W * .51, H - bottom * .48, bottom * .42, -.08)
      line(x - s * .01, y, x - s * .01, y + h, ink, .01); break
    }
    case 'heroimpact': {
      shell(irregular('burst', 4), '#f34c34', () => { dots('#972855', .027, .008); polygon([[0, H * .2], [W, 0], [W, y], [0, H * .7]], '#ffe340'); rays('#722251', 32, .005) })
      star(W * .54, H - bottom * .45, bottom * .65, '#ffe340', 9)
      text('BOOM!', W * .54, H - bottom * .46, bottom * .4, ink, -.14, W * .72)
      text('01', x * .52, y * .52, x * .58, cream, -.15); break
    }
    case 'shojobloom': {
      shell(irregular('wave'), '#ffd5e4', () => { dots('#e49bbd', .026, .003); line(x * .65, y * .7, W - x * .7, y * .7, '#a84d86', .003) }, '#ab4e85')
      for (const [cx, cy, scale] of [[x * .57, y * .56, .07], [W - x * .55, H - bottom * .6, .085], [W * .73, y * .5, .045]]) {
        for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; circle(cx + Math.cos(a) * s * scale * .65, cy + Math.sin(a) * s * scale * .65, s * scale * .53, '#a84d86'); circle(cx + Math.cos(a) * s * scale * .65, cy + Math.sin(a) * s * scale * .65, s * scale * .46, cream) }
        circle(cx, cy, s * scale * .24, '#f3a6bf')
      }
      star(W - x * .55, y + h * .24, s * .045, cream, 4); text('LOVE LETTER', W * .45, H - bottom * .5, bottom * .22, '#a84d86', -.08, w * .8); break
    }
    case 'brokenpanels': {
      shell(irregular('cut', 8), ink)
      panel([[s * .03, y * .25], [W * .58, s * .02], [W * .5, y * .85], [s * .045, y * 1.2]], cream, 'TO BE', W * .25, y * .54, y * .31, -.13)
      panel([[W * .61, s * .025], [W - s * .02, y * .12], [W - s * .04, y * 1.3], [W * .54, y * .84]], '#ffd946', 'CONTINUED', W * .77, y * .53, y * .18, .12)
      panel([[s * .02, y * 1.3], [x * .89, y], [x * .83, H * .59], [x * .16, H * .67]], '#d2cfed')
      panel([[W - x * .87, y], [W - s * .02, y * 1.1], [W - x * .13, H * .63], [W - x * .9, H * .55]], cream)
      panel([[x * .12, H * .7], [x * .9, H * .61], [W * .6, H - bottom * .82], [W * .43, H - s * .03], [s * .02, H - bottom * .28]], cream, '…?!', x * .48, H * .78, x * .5)
      panel([[W * .64, H - bottom * .86], [W - x * .92, H * .59], [W - x * .1, H * .68], [W - s * .03, H - s * .04], [W * .48, H - s * .03]], '#ffcf41', 'NEXT!', W * .73, H - bottom * .42, bottom * .36, -.08)
      break
    }
    case 'inkslash': {
      const shapes = [ [[0,y*.5],[W*.83,0],[W,y*.38],[x,y*1.05]], [[W-x*.92,y*.3],[W,y*.05],[W-x*.2,H],[W-x*1.03,y+h]], [[W,H-bottom*.5],[W*.23,H],[0,H-bottom*.3],[W-x,H-bottom*1.04]], [[x*.15,0],[x*1.02,y],[x*.89,H-bottom*.25],[0,H]] ]
      shapes.forEach(p=>polygon(p,ink))
      for(let i=0;i<90;i++){const side=i%4,t=noise(i,19),a=side%2?W*t:(side===0?x*.55:W-x*.55),b=side%2?(side===1?y*.45:H-bottom*.5):H*t;circle(a,b,s*(.002+noise(i,28)*.018),ink)}
      line(x*.18,y*.5,W*.85,y*.15,'#fff2d2',.008);text('CUT!',W*.72,H-bottom*.45,bottom*.4,'#fff2d2',-.12);break
    }
    case 'tornzine': {
      polygon([[0,y*.2],[W*.87,0],[W,H-bottom*.2],[x*.25,H]],'#fb79a8',ink)
      polygon([[x*.3,0],[W,y*.35],[W-x*.3,H],[0,H-bottom*.35]],'#81d6cd',ink)
      shell(inset(irregular('torn',18),s*.025),cream,()=>dots('#b7ab94',.023,.0018))
      panel([[W*.12,H-bottom*.83],[W*.82,H-bottom*.95],[W*.85,H-bottom*.27],[W*.15,H-bottom*.14]],'#242031','NO RULES',W*.49,H-bottom*.54,bottom*.3,-.06)
      text('NO RULES',W*.49,H-bottom*.54,bottom*.3,'#e5f762',-.06)
      polygon([[x*.25,y*.05],[x*1.27,y*.55],[x*.97,y*.83],[0,y*.31]],'#f8bb4bcc')
      polygon([[W-x*.8,H-bottom*.83],[W-x*.03,H-bottom*.43],[W-x*.25,H-bottom*.22],[W-x*1.05,H-bottom*.64]],'#f8bb4bcc');break
    }
    case 'roughsketch': {
      shell(irregular('torn',34), '#f4ead2', null, '#6b5b55')
      for(let i=0;i<5;i++){const o=s*(.015+i*.006);const p=[[o,y*.3+o],[W-o*2,o],[W-o,H-o],[o*1.5,H-bottom*.2-o]];ctx.strokeStyle=i%2?'#a1907b':'#6b5b55';ctx.lineWidth=s*.0015;path(p);ctx.stroke()}
      for(let i=0;i<25;i++)line(x*.28+i*s*.009,H-bottom*.8,x*.15+i*s*.009,H-bottom*.26,'#7d6e61',.001)
      text('unfinished / 01',W*.65,H-bottom*.45,bottom*.18,'#6b5b55',-.08,w*.7);break
    }
    case 'speechcut': {
      const left=s*.018,right=W-s*.018,top=s*.018,base=H-bottom*.45,r=s*.09
      ctx.beginPath();ctx.moveTo(left+r,top);ctx.lineTo(right-r,top);ctx.quadraticCurveTo(right,top,right,top+r)
      ctx.lineTo(right,base-r);ctx.quadraticCurveTo(right,base,right-r,base);ctx.lineTo(W*.87,base)
      ctx.lineTo(W*.85,H-s*.015);ctx.lineTo(W*.62,base);ctx.lineTo(left+r,base);ctx.quadraticCurveTo(left,base,left,base-r)
      ctx.lineTo(left,top+r);ctx.quadraticCurveTo(left,top,left+r,top);ctx.closePath();ctx.fillStyle='#ffe76b';ctx.fill();ctx.strokeStyle=ink;ctx.lineWidth=s*.009;ctx.stroke()
      text('SAY CHEESE!',W*.46,y*.49,y*.46,ink,-.04,w);break
    }
    case 'thoughtcut': {
      shell(irregular('wave',7).map(([a,b])=>[a,b>H-bottom?b-bottom*.16:b]), '#e6def7', null, '#73629c')
      circle(W*.74,H-bottom*.17,bottom*.14,'#73629c');circle(W*.74,H-bottom*.17,bottom*.12,'#e6def7')
      circle(W*.86,H-bottom*.08,bottom*.065,'#73629c');circle(W*.86,H-bottom*.08,bottom*.05,'#e6def7')
      for(let i=0;i<3;i++)circle(W*.43+i*s*.065,y*.53,s*.016,'#73629c')
      text('DAY DREAM',W*.4,H-bottom*.54,bottom*.24,'#73629c',-.06,w*.8);break
    }
    case 'speedribbon': {
      const points=[[0,y*.55],[W*.86,0],[W-x*.15,y*.5],[W,y+h*.85],[W-x*.38,H-bottom*.22],[W*.12,H],[x*.2,H-bottom*.4],[0,y*1.4]]
      shell(points,'#ff673c',()=>{for(let i=0;i<20;i++)line(-W*.1,H*i/18,W*1.2,H*i/18-H*.17,i%3?'#ffcf49':ink,i%3?.004:.013)})
      polygon([[x*.2,H-bottom*.3],[W*.8,H-bottom*.93],[W*.87,H-bottom*.36],[x*.65,H]],'#ffe544',ink)
      text('GO! GO!',W*.52,H-bottom*.48,bottom*.36,ink,-.19,w*.85);break
    }
    case 'halftoneteeth': {
      shell(irregular('burst',28),'#f6b7d7',()=>dots('#583471',.026,.007),'#583471')
      polygon([[W*.03,y*.17],[W*.72,0],[W*.55,y*.72],[W*.09,y*1.1]],'#ffef80','#583471')
      text('POP!',W*.27,y*.49,y*.53,'#583471',-.13,w*.65)
      star(W-x*.48,H-bottom*.52,bottom*.38,'#ffef80',5);break
    }
    case 'misregister': {
      polygon([[0,y*.3],[W-x*.2,0],[W,H-bottom*.1],[x*.3,H]],'#ff60a2')
      polygon([[x*.35,0],[W,y*.4],[W-x*.35,H],[0,H-bottom*.4]],'#52d5d9')
      shell([[x*.23,y*.28],[W-x*.3,y*.2],[W-x*.25,H-bottom*.32],[x*.18,H-bottom*.27]],'#fff0bd',()=>{for(let i=0;i<16;i++)line(0,H*i/15,W,H*i/15-s*.09,'#29283d',.002)})
      text('OFF',x*.73,y*.55,y*.46,'#ff4090',-.12);text('PRINT',W*.69,H-bottom*.54,bottom*.32,'#35324a',-.05);break
    }
    case 'foldcorner': {
      const points=[[x*.06,y*.06],[W-x*.65,0],[W,y*.65],[W-x*.05,H-bottom*.07],[x*.5,H],[0,H-bottom*.54]]
      shell(points,'#f5e6bf',()=>{for(let i=0;i<35;i++)line(0,i*s*.055,W,i*s*.055,'#a6987e50',.0015)})
      polygon([[W-x*.65,0],[W-x*.8,y*.73],[W,y*.65]],'#b2a6ba',ink,.003)
      polygon([[0,H-bottom*.54],[x*.64,H-bottom*.63],[x*.5,H]],'#ce906e',ink,.003)
      text('DRAFT 001',W*.48,y*.46,y*.24,'#73574a',-.04);text('KEEP THE ROUGH.',W*.6,H-bottom*.48,bottom*.18,'#73574a',-.03);break
    }
    case 'paintspill': {
      shell(irregular('cut',91),'#b6a5f6',null,'#3b2c71')
      for(let i=0;i<44;i++){const side=i%4,t=noise(i,72),cx=side%2?W*t:(side===0?x*.5:W-x*.5),cy=side%2?(side===1?y*.4:H-bottom*.45):H*t,r=s*(.008+noise(i,73)*.035);circle(cx,cy,r*1.13,'#3b2c71');circle(cx,cy,r,i%3?'#b6a5f6':'#7edfd7')}
      for(let i=0;i<6;i++){const cx=x+w*(.08+i*.17);ctx.strokeStyle='#3b2c71';ctx.lineWidth=s*(.008+(i%3)*.004);ctx.lineCap='round';ctx.beginPath();ctx.moveTo(cx,y*.28);ctx.lineTo(cx+s*.016,y*.74);ctx.stroke()}ctx.lineCap='butt'
      text('SPLASH',W*.52,H-bottom*.5,bottom*.33,'#3b2c71',-.08);break
    }
    case 'graffiticut': {
      shell(irregular('cut',57),'#ddf25c',()=>{for(let i=0;i<9;i++){const cy=H*i/8;line(0,cy,W,cy-s*.13,'#293431',.004)}})
      polygon([[x*.05,y*.34],[W*.75,0],[W*.7,y*.72],[x*.2,y*1.1]],'#f28cba',ink)
      text('LOUD!',W*.37,y*.52,y*.53,ink,-.14,w*.8)
      polygon([[x*.3,H-bottom*.92],[W*.9,H-bottom*.8],[W*.84,H-bottom*.12],[x*.05,H-bottom*.3]],cream,ink)
      text('NOT A COPY',W*.5,H-bottom*.5,bottom*.29,ink,.04,w*.95)
      for(const [cx,cy]of[[x*.48,y+h*.37],[W-x*.5,y+h*.65]]){line(cx-s*.055,cy-s*.045,cx+s*.055,cy+s*.045,'#ef4c77',.018);line(cx+s*.055,cy-s*.045,cx-s*.055,cy+s*.045,'#ef4c77',.018)}break
    }
    case 'zigzagcut': {
      const p=[[0,y*.4],[W*.34,0],[W*.3,y*.38],[W*.8,0],[W*.73,y*.32],[W,y*.18],[W-x*.28,H*.37],[W,H*.31],[W-x*.12,H*.74],[W,H*.68],[W-x*.2,H],[W*.58,H-bottom*.25],[W*.63,H],[W*.18,H-bottom*.12],[W*.23,H],[0,H-bottom*.23],[x*.28,H*.66],[0,H*.72],[x*.2,H*.29],[0,H*.34]]
      shell(p,'#ffe650',()=>{rays('#9d5d24',44,.002);polygon([[0,H*.75],[W,H*.52],[W,H],[0,H]],'#f64b57')})
      text('ZAP!',W*.59,H-bottom*.5,bottom*.5,cream,-.1,w*.7);break
    }
    case 'contourcut': {
      const p=irregular('wave',23)
      shell(p,'#ee8fab',null,'#7a3569')
      for(let i=1;i<5;i++){path(inset(p,s*.013*i));ctx.strokeStyle=i%2?'#fff1bb':'#7a3569';ctx.lineWidth=s*.006;ctx.stroke()}
      text('ODD ONE OUT',W*.5,H-bottom*.49,bottom*.23,'#713361',-.05,w*.9)
      star(x*.53,y*.57,s*.046,'#fff1bb',4);break
    }
  }
}

function drawSpecialFrame(ctx, recipe, { x, y, w, h, W, H, s, bottom }, { noise, inkText }) {
  const stroke = (color, size = .003) => { ctx.strokeStyle = color; ctx.lineWidth = Math.max(.5, s * size) }
  const line = (ax, ay, bx, by, color, size) => { stroke(color, size); ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke() }
  const circle = (cx, cy, r, color) => { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill() }
  const polygon = (points, color) => { ctx.fillStyle = color; ctx.beginPath(); points.forEach(([px, py], i) => i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)); ctx.closePath(); ctx.fill() }
  const rect = (a, b, c, d, color) => { ctx.fillStyle = color; ctx.fillRect(a, b, c, d) }
  const round = (a, b, c, d, radius, color) => { ctx.fillStyle = color; ctx.beginPath(); ctx.roundRect(a, b, c, d, radius); ctx.fill() }
  const text = (label, px, py, size, color = '#252127', align = 'left', max = W) => inkText(ctx, label, px, py, size, color, align, max)
  switch (recipe.frame) {
    case 'terrazzo': {
      for (let i = 0; i < 800; i++) {
        const cx = noise(i, 2) * W, cy = noise(i, 3) * H, size = s * (.008 + noise(i, 4) * .025)
        if (cx > x && cx < x + w && cy > y && cy < y + h) continue
        polygon([[cx, cy], [cx + size, cy - size * .4], [cx + size * .75, cy + size], [cx - size * .2, cy + size * .4]], ['#cb8278', '#6d9990', '#d9bd75', '#77768b'][i % 4])
      } break
    }
    case 'handheld': {
      ctx.clearRect(0, 0, W, H); round(0, 0, W, H, [s * .05, s * .05, s * .15, s * .05], '#b1a0d7')
      round(s * .016, s * .012, W - s * .032, H - s * .035, [s * .04, s * .04, s * .14, s * .04], '#d1bee9')
      round(x * .55, y * .48, w + x * .9, h + y * .7, s * .04, '#4d4866')
      text('POCKET / MEMORY', x, y * .3, y * .13, '#3c315b')
      const cx = x + s * .09, cy = H - bottom * .5
      round(cx - s * .09, cy - s * .03, s * .18, s * .06, s * .008, '#39344b'); round(cx - s * .03, cy - s * .09, s * .06, s * .18, s * .008, '#39344b')
      circle(cx, cy, s * .02, '#211c32')
      circle(W - x - s * .03, cy - s * .025, s * .043, '#e75088'); circle(W - x - s * .14, cy + s * .035, s * .043, '#e75088')
      for (let i = 0; i < 5; i++) line(W * .53 + i * s * .025, H - bottom * .24, W * .53 + i * s * .025, H - bottom * .1, '#8c76aa', .007)
      text('SELECT   START', W * .38, H - bottom * .14, s * .018, '#77618d'); break
    }
    case 'editorial': {
      text('ICON', W * .5, y * .49, y * 1.04, '#ffe5bd', 'center', W * .96)
      rect(0, y * .9, W, y * .025, '#272022')
      ctx.save(); ctx.translate(x * .55, y + h * .51); ctx.rotate(-Math.PI / 2); text('THE NEW ORIGINALS', 0, 0, x * .47, '#ffe5bd', 'center', h * .95); ctx.restore()
      text('NO. 01', W - x * .2, H - bottom * .64, bottom * .55, '#ffe5bd', 'right', w * .6)
      text('MAKE A SCENE.', x, H - bottom * .25, bottom * .23, '#272022')
      for (let i = 0; i < 30; i++) rect(x + i * s * .005, H - bottom * .85, s * (i % 3 ? .002 : .004), bottom * .28, '#272022')
      break
    }
    default: drawComicFrame(ctx, recipe, { x, y, w, h, W, H, s, bottom }, { noise, inkText })
  }
}

// External artwork only: the caller clips every mark away from the source rectangle.
const themedFrameMargins = {
  ticket: [.09, .12, .22], polaroid: [.055, .055, .2], riso: [.11, .15, .18],
  memphis: [.14, .14, .14], lace: [.14, .14, .14], postal: [.1, .12, .22],
  circuit: [.12, .13, .16], mosaic: [.13, .13, .13], wave: [.13, .14, .18],
  zebra: [.13, .13, .13], blueprint: [.12, .13, .17], news: [.09, .2, .23],
}
const themedFramePapers = {
  ticket: '#ff754c', polaroid: '#faf9f5', riso: '#f3edcf', memphis: '#ffdfed', lace: '#1d112c',
  postal: '#fff0d3', circuit: '#091f22', mosaic: '#1f203a', wave: '#f1e4be',
  zebra: '#f8f3df', blueprint: '#164196', news: '#e9dfc9',
}

function drawThemedFrame(ctx, recipe, { x, y, w, h, W, H, s, bottom }, { inkText, caption, noise, createPath }) {
  const line = (ax, ay, bx, by, color, width = s * .004) => {
    ctx.strokeStyle = color; ctx.lineWidth = Math.max(.7, width)
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke()
  }
  const ring = (cx, cy, radius, color, width = s * .004) => {
    ctx.strokeStyle = color; ctx.lineWidth = Math.max(.7, width)
    ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.stroke()
  }
  const dot = (cx, cy, radius, color) => {
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.fill()
  }
  switch (recipe.frame) {
    case 'ticket': {
      ctx.fillStyle = '#242023'; ctx.fillRect(0, 0, W, y * .22)
      inkText(ctx, 'ADMIT ONE', x, y * .61, y * .51, '#242023', 'left', w * .73)
      inkText(ctx, 'LIVE', W - x, y * .6, y * .24, '#242023', 'right')
      ctx.setLineDash([s * .012, s * .012]); line(x * .5, y, x * .5, H - bottom * .13, '#242023'); line(W - x * .5, y, W - x * .5, H - bottom * .13, '#242023'); ctx.setLineDash([])
      ctx.fillStyle = '#fff2d2'; ctx.fillRect(x, H - bottom * .84, w, bottom * .65)
      if (recipe.caption) caption(ctx, recipe.caption, W / 2, H - bottom * .53, w * .86, s * .04, '#242023')
      else inkText(ctx, 'ONE NIGHT ONLY', W / 2, H - bottom * .53, bottom * .27, '#242023', 'center', w * .86)
      for (let i = 0; i < 42; i++) { ctx.fillStyle = '#242023'; ctx.fillRect(x + w * i / 42, H - bottom * .14, w / 84 * (i % 3 ? 1 : 2), bottom * .1) }
      // Punches cut only the outer ticket edge; the source remains inside the clip hole.
      ctx.save(); ctx.globalCompositeOperation = 'destination-out'
      for (let cy = y * .6; cy < H; cy += s * .09) { dot(0, cy, s * .018, '#000'); dot(W, cy, s * .018, '#000') }
      ctx.restore(); break
    }
    case 'polaroid': {
      // The image keeps its aspect ratio. All printing sits on the lower paper margin.
      ctx.strokeStyle = '#dedbd3'; ctx.lineWidth = Math.max(.5, s * .001)
      ctx.strokeRect(s * .001, s * .001, W - s * .002, H - s * .002)
      ctx.strokeStyle = '#c4c1b9'; ctx.lineWidth = Math.max(.5, s * .0015)
      ctx.strokeRect(x - s * .001, y - s * .001, w + s * .002, h + s * .002)
      const baseline = y + h + bottom * .51
      const logoSize = s * .088
      drawLeicaLogo(ctx, x, baseline - logoSize / 2, logoSize, createPath)
      inkText(ctx, 'LEICA', x + logoSize + s * .022, baseline, s * .033, '#222421', 'left', w * .23)
      ctx.font = `${Math.max(3, s * .022)}px "Microsoft YaHei", Arial, sans-serif`
      ctx.fillStyle = '#40413d'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle'
      ctx.fillText(recipe.cameraSettings, W - x, baseline, w * .57)
      break
    }
    case 'riso': {
      ctx.fillStyle = '#ef3c57'; ctx.fillRect(0, 0, W * .62, y * .9); ctx.fillRect(W - x * .75, 0, x, H)
      ctx.fillStyle = '#007f96'; ctx.fillRect(0, y * .7, x * .8, H); ctx.fillRect(W * .3, H - bottom * .78, W, bottom)
      inkText(ctx, 'RISO / 02', x, y * .45, y * .52, '#f6f0cc', 'left', w * .9)
      inkText(ctx, 'OFF REGISTER', W - x, H - bottom * .42, bottom * .33, '#f6f0cc', 'right', w * .95)
      for (let cy = 0; cy < H; cy += s * .025) for (const cx of [x * .45, W - x * .4]) dot(cx, cy, s * .005, '#242838')
      break
    }
    case 'memphis': {
      const tile = s * .12
      for (let cy = 0; cy < H; cy += tile) for (let cx = 0; cx < W; cx += tile) {
        if (cx > x && cx + tile < x + w && cy > y && cy + tile < y + h) continue
        const k = Math.round(cx / tile + cy / tile) % 3
        if (k === 0) { ctx.fillStyle = '#ff6146'; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + tile * .85, cy + tile * .18); ctx.lineTo(cx + tile * .2, cy + tile * .9); ctx.fill() }
        else if (k === 1) ring(cx + tile * .5, cy + tile * .5, tile * .3, '#1855b4', s * .012)
        else { line(cx, cy + tile * .2, cx + tile * .5, cy + tile * .8, '#202032', s * .014); line(cx + tile * .5, cy + tile * .8, cx + tile, cy + tile * .2, '#202032', s * .014) }
      }
      break
    }
    case 'lace': {
      for (let cy = s * .035; cy < H; cy += s * .052) for (const cx of [x * .46, W - x * .46]) {
        ring(cx, cy, x * .34, '#bf9abf', s * .002); ring(cx, cy, x * .19, '#70587d', s * .002); dot(cx, cy, s * .006, '#ead5dc')
      }
      for (let cx = s * .035; cx < W; cx += s * .052) for (const cy of [y * .45, H - bottom * .45]) {
        ring(cx, cy, y * .3, '#bf9abf', s * .002); dot(cx, cy, s * .005, '#ead5dc')
      }
      ctx.strokeStyle = '#d5b2c8'; ctx.lineWidth = s * .005; ctx.strokeRect(x * .82, y * .82, W - x * 1.64, H - y * .82 - bottom * .82)
      break
    }
    case 'postal': {
      ctx.save(); ctx.lineWidth = s * .032
      for (let i = -H; i < W; i += s * .07) { ctx.strokeStyle = Math.round((i + H) / (s * .07)) % 2 ? '#df4739' : '#235293'; ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + H, H); ctx.stroke() }
      ctx.restore(); ctx.fillStyle = '#fff0d3'; ctx.fillRect(x * .42, y * .33, W - x * .84, H - y * .33 - bottom * .17)
      inkText(ctx, 'PAR AVION', x, y * .61, y * .31, '#235293', 'left', w * .65)
      ring(W - x - y * .36, y * .56, y * .32, '#a33e30', s * .003)
      caption(ctx, recipe.caption || 'Wish you were here.', W / 2, H - bottom * .51, w * .88, s * .037, '#235293')
      for (let j = 0; j < 3; j++) line(x, H - bottom * (.23 - j * .04), W - x, H - bottom * (.23 - j * .04), '#b29b7c', s * .001)
      break
    }
    case 'circuit': {
      for (let i = 0; i < 6; i++) {
        const inset = s * (.018 + i * .014)
        ctx.strokeStyle = i % 2 ? '#92de57' : '#30a78e'; ctx.lineWidth = Math.max(1, s * .003)
        ctx.beginPath(); ctx.moveTo(inset, H * .7); ctx.lineTo(inset, inset * 2); ctx.lineTo(inset * 2, inset); ctx.lineTo(W - inset * 2, inset); ctx.lineTo(W - inset, inset * 2); ctx.lineTo(W - inset, H * .75); ctx.stroke()
        dot(inset, H * .7, s * .005, '#f1d277'); dot(W - inset, H * .75, s * .005, '#f1d277')
      }
      for (let i = 0; i < 13; i++) { ctx.fillStyle = '#d4b369'; ctx.fillRect(x + w * i / 13, H - bottom * .28, w / 22, bottom * .28) }
      inkText(ctx, 'MEMORY / 020', W / 2, H - bottom * .6, bottom * .29, '#a5f295', 'center', w * .9)
      break
    }
    case 'mosaic': {
      const tile = s * .085, colors = ['#eb9443', '#228c91', '#8c4378', '#eee2ad', '#3b4b9b']
      for (let cy = 0; cy < H; cy += tile) for (let cx = 0; cx < W; cx += tile) {
        if (cx > x && cx + tile < x + w && cy > y && cy + tile < y + h) continue
        const k = Math.floor(noise(Math.round(cx), Math.round(cy)) * colors.length)
        ctx.fillStyle = colors[k]; ctx.fillRect(cx + s * .004, cy + s * .004, tile - s * .008, tile - s * .008)
        ctx.fillStyle = colors[(k + 2) % colors.length]; ctx.beginPath(); ctx.moveTo(cx + tile * .1, cy + tile * .1); ctx.lineTo(cx + tile * .9, cy + tile * .1); ctx.lineTo(cx + tile * .9, cy + tile * .9); ctx.fill()
      }
      break
    }
    case 'wave': {
      for (let j = -1; j < H / (s * .04) + 1; j++) {
        ctx.strokeStyle = j % 3 ? '#225377' : '#79a8ac'; ctx.lineWidth = s * .014; ctx.beginPath()
        for (let px = 0; px <= W + s * .01; px += s * .01) { const py = j * s * .04 + Math.sin(px / s * 24 + j * .6) * s * .025; if (px === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py) }
        ctx.stroke()
      }
      dot(W - x * .55, y * .55, s * .045, '#d74736')
      ctx.fillStyle = '#f1e4be'; ctx.fillRect(x + w * .12, H - bottom * .8, w * .76, bottom * .59)
      inkText(ctx, 'THE GREAT MOMENT', W / 2, H - bottom * .5, bottom * .22, '#225377', 'center', w * .69)
      break
    }
    case 'zebra': {
      ctx.fillStyle = '#191820'
      for (let j = -2; j < W / (s * .1) + 2; j++) {
        ctx.beginPath()
        for (let py = 0; py <= H + s * .02; py += s * .02) { const px = j * s * .1 + Math.sin(py / s * 13 + j) * s * .045; if (py === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py) }
        for (let py = H + s * .02; py >= 0; py -= s * .02) ctx.lineTo(j * s * .1 + Math.sin(py / s * 13 + j + .5) * s * .045 + s * .04, py)
        ctx.closePath(); ctx.fill()
      }
      ctx.strokeStyle = '#c5ff33'; ctx.lineWidth = s * .009; ctx.strokeRect(x * .85, y * .85, W - x * 1.7, H - y * .85 - bottom * .85)
      break
    }
    case 'blueprint': {
      for (let px = 0; px < W; px += s * .04) line(px, 0, px, H, '#8cb9e34d', s * .001)
      for (let py = 0; py < H; py += s * .04) line(0, py, W, py, '#8cb9e34d', s * .001)
      for (let py = y; py <= y + h; py += s * .04) line(x * .3, py, x * .3 + s * .018, py, '#eef8ff', s * .002)
      line(x, y * .5, W - x, y * .5, '#eef8ff'); line(x, y * .3, x, y * .7, '#eef8ff'); line(W - x, y * .3, W - x, y * .7, '#eef8ff')
      inkText(ctx, 'FIG. 01 / HUMAN STUDY', x, H - bottom * .6, bottom * .23, '#eef8ff', 'left', w * .95)
      inkText(ctx, 'SCALE 1:1   /   LNSH LAB', x, H - bottom * .25, bottom * .13, '#a7d9fa', 'left', w * .9)
      break
    }
    case 'news': {
      inkText(ctx, 'THE DAILY FRAME', W / 2, y * .43, y * .38, '#26231d', 'center', w)
      line(x, y * .74, W - x, y * .74, '#26231d', s * .005)
      inkText(ctx, 'SPECIAL EDITION  /  CULTURE & PEOPLE', W / 2, y * .86, y * .09, '#26231d', 'center', w)
      inkText(ctx, 'A MOMENT WORTH KEEPING', x, H - bottom * .74, bottom * .19, '#26231d', 'left', w)
      for (let col = 0; col < 3; col++) for (let row = 0; row < 7; row++) {
        const left = x + col * w / 3, len = (w / 3 - s * .025) * (.6 + noise(col, row) * .4)
        line(left, H - bottom * (.5 - row * .055), left + len, H - bottom * (.5 - row * .055), '#686152', s * .002)
      }
      break
    }
  }
}

const slash = [[0, .16], [.97, 0], [1, .86], [.03, 1]]
const lightningLeft = [[0, .04], [1, 0], [.72, .38], [.96, .34], [.61, .73], [.8, .68], [.46, 1], [.02, .94]]
const lightningRight = [[.48, 0], [1, .04], [.98, .97], [0, 1], [.29, .66], [.09, .72], [.39, .3], [.17, .35]]

// Comic frames own a composition, including masks inside the source rectangle.
// The filtered source remains a separate canvas; only the derived PNG is cropped.
function composeComicPhoto(ctx, photo, recipe, layout, helpers) {
  if (!comicFrameIds.has(recipe.frame)) return false
  const { W, H, s } = layout, { noise, inkText } = helpers
  drawComicFrame(ctx, { ...recipe, photoComposition: true }, layout, helpers)
  const ink = '#231e31', paper = '#fff4d9'
  const path = (points, w, h) => { ctx.beginPath(); points.forEach(([u, v], i) => i ? ctx.lineTo(u * w, v * h) : ctx.moveTo(u * w, v * h)); ctx.closePath() }
  const torn = seed => {
    const points = []
    for (let i = 0; i <= 16; i++) points.push([.02 + i * .06, .02 + noise(i, seed) * .04])
    for (let i = 1; i <= 20; i++) points.push([.94 + noise(i, seed + 1) * .05, i * .047])
    for (let i = 16; i >= 0; i--) points.push([.02 + i * .06, .94 + noise(i, seed + 2) * .05])
    for (let i = 20; i >= 1; i--) points.push([.01 + noise(i, seed + 3) * .04, i * .047])
    return points
  }
  const scallop = () => Array.from({ length: 120 }, (_, i) => {
    const a = i / 120 * Math.PI * 2, wave = 1 + .035 * Math.sin(a * 13)
    const u = Math.sign(Math.cos(a)) * Math.abs(Math.cos(a)) ** .45 * .46 * wave
    const v = Math.sign(Math.sin(a)) * Math.abs(Math.sin(a)) ** .45 * .46 * wave
    return [.5 + u, .5 + v]
  })
  const shape = (points, color, outline = ink, width = .009) => {
    path(points, W, H); ctx.fillStyle = color; ctx.fill()
    if (outline) { ctx.lineJoin = 'round'; ctx.strokeStyle = outline; ctx.lineWidth = s * width; ctx.stroke() }
  }
  const card = (bounds, points, { angle = 0, crop = [0, 0, 1, 1], rim = paper, border = .012, shadow = true } = {}) => {
    const [bx, by, bw, bh] = bounds, cw = bw * W, ch = bh * H
    ctx.save(); ctx.translate(bx * W + cw / 2, by * H + ch / 2); ctx.rotate(angle); ctx.translate(-cw / 2, -ch / 2)
    if (shadow) { ctx.save(); ctx.translate(s * .014, s * .019); path(points, cw, ch); ctx.fillStyle = ink; ctx.fill(); ctx.restore() }
    path(points, cw, ch); ctx.fillStyle = rim; ctx.fill()
    ctx.save(); path(points, cw, ch); ctx.clip()
    const [u, v, ww, hh] = crop, sw = photo.width * ww, sh = photo.height * hh, scale = Math.max(cw / sw, ch / sh)
    ctx.drawImage(photo, u * photo.width, v * photo.height, sw, sh, (cw - sw * scale) / 2, (ch - sh * scale) / 2, sw * scale, sh * scale)
    ctx.restore()
    path(points, cw, ch); ctx.lineJoin = 'round'; ctx.strokeStyle = rim; ctx.lineWidth = s * border * 2; ctx.stroke()
    path(points, cw, ch); ctx.strokeStyle = ink; ctx.lineWidth = s * .003; ctx.stroke(); ctx.restore()
  }
  const label = (word, cx, cy, size, color = ink, angle = 0, max = .7) => {
    ctx.save(); ctx.translate(W * cx, H * cy); ctx.rotate(angle); inkText(ctx, word, 0, 0, s * size, color, 'center', W * max); ctx.restore()
  }
  const tape = (cx, cy, angle = 0) => {
    ctx.save(); ctx.translate(W * cx, H * cy); ctx.rotate(angle)
    ctx.fillStyle = '#f2b445cc'; ctx.fillRect(-s * .09, -s * .027, s * .18, s * .054)
    ctx.strokeStyle = '#a76e35'; ctx.lineWidth = s * .0015
    for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(-s * .07, s * (-.02 + i * .012)); ctx.lineTo(s * .07, s * (-.02 + i * .012)); ctx.stroke() }
    ctx.restore()
  }
  const burst = (cx, cy, rw, rh, word, fill = '#ffe347') => {
    const points = Array.from({ length: 22 }, (_, i) => { const a = i * Math.PI / 11, r = i % 2 ? .61 : 1; return [cx + Math.cos(a) * rw * r, cy + Math.sin(a) * rh * r] })
    shape(points, fill); label(word, cx, cy, rw * 1.2, ink, -.1, rw * 1.8)
  }
  const mouth = (word, cx, cy, rw, rh, fill = paper) => {
    const points = [[cx-rw,cy-rh],[cx+rw,cy-rh*.8],[cx+rw*.92,cy+rh*.6],[cx+rw*.38,cy+rh*.65],[cx+rw*.06,cy+rh*1.65],[cx-rw*.1,cy+rh*.64],[cx-rw,cy+rh*.8]]
    shape(points, fill); label(word,cx,cy,rh*1.1,ink,-.04,rw*1.8)
  }
  switch (recipe.frame) {
    case 'brokenpanels':
      card([.08,.12,.63,.78], [[0,.02],[.94,0],[1,.7],[.82,1],[.04,.95]], { angle:-.035 })
      card([.65,.12,.28,.25], slash, { angle:.055,crop:[.12,.035,.76,.26],rim:'#ffdf55' })
      card([.69,.4,.25,.31], [[0,.08],[1,0],[.94,.98],[.04,1]], { angle:.045,crop:[.18,.35,.66,.34] })
      card([.55,.74,.38,.18], slash, { angle:-.08,crop:[.08,.76,.84,.23],rim:'#ffdf55' })
      mouth('…?!',.18,.79,.12,.055);break
    case 'mangaburst':
      card([.1,.13,.79,.75], [[0,.06],[1,0],[.91,.79],[.54,.75],[.47,1],[.04,.93]], {angle:-.035})
      card([.53,.67,.36,.22], slash, {angle:.085,crop:[.12,.035,.76,.25]})
      burst(.18,.68,.13,.085,'!?',paper);break
    case 'heroimpact':
      card([.12,.1,.77,.81], [[.05,0],[1,.06],[.92,.59],[1,.78],[.68,1],[0,.89]], {angle:.04,rim:'#ffe647'})
      card([.05,.57,.28,.2],slash,{angle:-.13,crop:[.12,.06,.76,.24],rim:paper})
      burst(.74,.79,.19,.1,'BOOM!');break
    case 'shojobloom':
      card([.13,.13,.76,.75],scallop(),{angle:-.045,rim:'#fff5eb'})
      card([.62,.69,.27,.22],torn(46),{angle:.16,crop:[.12,.03,.76,.26],rim:'#fff5eb',border:.017})
      tape(.7,.705,-.2);mouth('LOVE',.19,.72,.13,.06,'#ffd8e7');break
    case 'inkslash':
      card([.1,.12,.8,.3],[[0,.16],[.96,0],[1,.75],[.05,1]],{angle:-.045,crop:[0,0,1,.37],rim:ink,border:.008})
      card([.14,.38,.77,.3],slash,{angle:.04,crop:[0,.3,1,.38],rim:ink,border:.009})
      card([.08,.65,.78,.24],slash,{angle:-.045,crop:[0,.68,1,.32],rim:ink,border:.009})
      break
    case 'tornzine':
      card([.08,.12,.8,.78],torn(12),{angle:-.065,border:.02})
      card([.64,.17,.28,.26],torn(17),{angle:.12,crop:[.12,.03,.76,.27],rim:'#ffc0da',border:.018})
      card([.58,.64,.33,.23],torn(20),{angle:-.12,crop:[.1,.55,.8,.34],rim:'#a4e6da',border:.02})
      tape(.19,.17,-.4);tape(.76,.65,.25);break
    case 'roughsketch':
      card([.12,.12,.75,.77],torn(57),{angle:.025,rim:'#fff7df',border:.023})
      shape([[.06,.71],[.4,.75],[.38,.86],[.05,.82]],'#f6e8c6','#796559',.003)
      label('study / 01',.23,.78,.035,'#796559',.1,.31);tape(.73,.15,-.12);break
    case 'speechcut':
      card([.1,.13,.8,.7],[[.05,0],[1,.04],[.94,.78],[.6,.8],[.51,1],[.46,.79],[0,.75]],{angle:-.025,rim:paper,border:.015})
      mouth('HELLO!',.73,.68,.16,.065,'#fff5d9');break
    case 'thoughtcut':
      card([.12,.13,.76,.72],scallop(),{angle:.035,rim:'#f4eeff',border:.019})
      shape([[.05,.67],[.37,.7],[.36,.82],[.09,.84]],'#eee5fa','#73629c',.004)
      label('what if…',.21,.75,.04,'#73629c',.04,.27);break
    case 'speedribbon':
      card([.09,.11,.81,.27],slash,{angle:-.06,crop:[0,0,1,.32],rim:'#fff0c4'})
      card([.14,.35,.78,.33],slash,{angle:.025,crop:[0,.25,1,.42],rim:'#fff0c4'})
      card([.06,.66,.78,.23],slash,{angle:-.06,crop:[0,.64,1,.36],rim:'#fff0c4'})
      shape([[.66,.56],[.98,.48],[.87,.64],[.93,.65],[.61,.75]],'#ffe53f',ink)
      label('GO!',.79,.62,.065,ink,-.2,.22);break
    case 'halftoneteeth':
      card([.12,.13,.77,.75],[[.04,0],[.95,.04],[.91,.23],[1,.35],[.9,.52],[.99,.68],[.86,1],[.05,.93],[.09,.7],[0,.6]],{angle:-.025,rim:'#fff3b7'})
      card([.06,.61,.32,.25],slash,{angle:.1,crop:[.12,.04,.76,.28],rim:'#f6b5d7'})
      burst(.78,.78,.14,.075,'POP!', '#fff18b');break
    case 'misregister':
      shape([[.13,.14],[.89,.09],[.95,.86],[.1,.92]],'#f467ad')
      shape([[.08,.2],[.85,.11],[.9,.93],[.16,.88]],'#53d5d8')
      card([.13,.14,.74,.72],torn(84),{angle:-.025,rim:paper,border:.009})
      card([.54,.65,.37,.22],slash,{angle:.09,crop:[.1,.03,.8,.27],rim:'#fbb8d6'})
      tape(.21,.19,-.2);break
    case 'foldcorner':
      card([.12,.12,.77,.77],[[.05,0],[.79,.025],[.99,.21],[.94,.97],[.16,1],[0,.82]],{angle:.035,border:.014})
      shape([[.72,.145],[.87,.3],[.68,.32]],'#c9b39c','#79685d',.004)
      shape([[.135,.75],[.29,.84],[.22,.68]],'#e7c798','#79685d',.004)
      tape(.55,.85,.1);break
    case 'paintspill':
      card([.12,.12,.77,.77],torn(101),{angle:-.025,rim:'#eee6ff',border:.02})
      for(let i=0;i<14;i++){
        const cx=.15+noise(i,166)*.18,cy=.64+noise(i,167)*.18,rr=s*(.008+noise(i,168)*.023)
        ctx.beginPath();ctx.arc(cx*W,cy*H,rr,0,Math.PI*2);ctx.fillStyle=i%3?'#392b70':'#8f78db';ctx.fill()
      }
      card([.65,.57,.26,.25],slash,{angle:.13,crop:[.12,.04,.76,.27],rim:'#b4a2ec'});break
    case 'graffiticut':
      card([.1,.14,.8,.74],[[.02,.03],[.96,0],[1,.48],[.92,.55],[.97,.98],[.09,.94],[0,.64]],{angle:-.045,rim:paper,border:.015})
      shape([[.07,.69],[.46,.75],[.43,.85],[.09,.79]],'#ed78ae')
      label('HEY YOU!',.27,.765,.057,ink,.13,.36)
      tape(.77,.22,.45);break
    case 'zigzagcut':
      card([.09,.13,.5,.75],lightningLeft,{angle:-.04,crop:[0,0,.59,1],rim:paper,border:.011})
      card([.43,.15,.48,.73],lightningRight,{angle:.045,crop:[.4,0,.6,1],rim:'#ffe959',border:.012})
      burst(.52,.7,.13,.07,'ZAP!', '#ff775d');break
    case 'contourcut':
      card([.12,.12,.77,.77],scallop(),{angle:-.045,rim:'#fff1bd',border:.024})
      card([.6,.65,.29,.24],scallop(),{angle:.12,crop:[.12,.035,.76,.25],rim:'#f3a3bf',border:.014})
      mouth('oh!',.2,.69,.1,.045,'#fff1bd');break
  }
  return true
}

function caption(context, text, x, y, width, size, color) {
  if (!text.trim()) return
  context.fillStyle = color
  context.textAlign = 'center'; context.textBaseline = 'middle'
  context.font = `${size}px "Microsoft YaHei", "PingFang SC", sans-serif`
  // Two lines, with a bounded font size. The user text never overlaps the photo.
  const chars = [...text.trim()], lines = ['']
  for (const char of chars) {
    const index = lines.length - 1
    if (context.measureText(lines[index] + char).width > width && lines.length < 2) lines.push(char)
    else lines[index] += char
  }
  lines.forEach((line, i) => context.fillText(line, x, y + (i - (lines.length - 1) / 2) * size * 1.45, width))
}

// Ratios size the output canvas. Traditional mounts retain the source rectangle;
// comic compositions use this space for their own photo masks and overlapping panels.
export function studioFinishLayout(w, h, recipe) {
  const s = Math.min(w, h), factor = recipe.border === 'wide' ? 1.4 : 1
  const margins = ({ none: [0, 0, 0], classic: [.02, .02, .02], white: [.065, .11, .16],
    aged: [.085, .1, .14], journal: [.105, .12, .22], gallery: [.085, .085, .19], comic: [.12, .14, .18], arcade: [.09, .11, .16], hazard: [.08, .11, .16], vinyl: [.12, .1, .22], ...themedFrameMargins, ...specialFrameMargins })[normalizeStudioFrame(recipe.frame)]
  const [x, y, bottom] = margins.map(ratio => ratio ? Math.max(2, Math.round(s * ratio * factor)) : 0)
  return { x, y, bottom, width: w + 2 * x, height: h + y + bottom }
}
function inkText(ctx, text, x, y, size, color = '#201e1c', align = 'left', maxWidth) {
  ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'middle'
  ctx.font = `900 ${Math.max(3, size)}px "Arial Black", "Microsoft YaHei", sans-serif`
  if (maxWidth) ctx.fillText(text, x, y, maxWidth)
  else ctx.fillText(text, x, y)
}
function stamp(ctx, x, y, radius, text, color) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(-.17)
  ctx.strokeStyle = color; ctx.lineWidth = Math.max(1, radius * .07)
  ctx.beginPath(); ctx.ellipse(0, 0, radius, radius * .52, 0, 0, Math.PI * 2); ctx.stroke()
  ctx.beginPath(); ctx.ellipse(-radius * .02, radius * .04, radius * 1.07, radius * .55, -.04, 0, Math.PI * 2); ctx.stroke()
  inkText(ctx, text, 0, 0, radius * .32, color, 'center', radius * 1.65)
  ctx.restore()
}

export function drawStudioFrame(ctx, photo, recipe, { x, y, w, h, W, H, s, bottom }, { noise, createPath }) {
  if (composeComicPhoto(ctx, photo, recipe, { x, y, w, h, W, H, s, bottom }, { inkText, noise })) return
  const ink = '#171715', orange = '#ff681f', acid = recipe.tone === 'dark' ? '#ff5b22' : '#d8f535'
  const paper = ({ none: '#ffffff', classic: '#ffffff', white: '#f5f3eb', aged: '#bb985f', journal: '#eee5cb', gallery: acid, comic: '#ffe436', arcade: '#180d38', hazard: '#f6ad24', vinyl: '#e5d5b9', ...themedFramePapers, ...specialFramePapers })[recipe.frame]
  // Outer tear mask is also retained for all decorations.
  ctx.save()
  if (recipe.frame === 'aged') {
    ctx.beginPath()
    for (let i = 0; i <= 70; i++) ctx.lineTo(W * i / 70, noise(i, 1) * s * .023)
    for (let i = 0; i <= 70; i++) ctx.lineTo(W - noise(i, 2) * s * .025, H * i / 70)
    for (let i = 70; i >= 0; i--) ctx.lineTo(W * i / 70, H - noise(i, 3) * s * .025)
    for (let i = 70; i >= 0; i--) ctx.lineTo(noise(i, 4) * s * .023, H * i / 70)
    ctx.closePath(); ctx.clip()
  }
  if (recipe.frame !== 'none') { ctx.fillStyle = paper; ctx.fillRect(0, 0, W, H) }
  ctx.clearRect(x, y, w, h)
  ctx.drawImage(photo, x, y)
  // Traditional mounts stay outside the photo; comic compositions are handled above.
  ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.rect(x, y, w, h); ctx.clip('evenodd')
  if (recipe.frame === 'white') {
    inkText(ctx, 'LINSHE', x, y * .53, y * .7, ink)
    ctx.fillStyle = orange; ctx.fillRect(W - x - y * .8, y * .16, y * .8, y * .62)
    inkText(ctx, '01', W - x - y * .4, y * .48, y * .42, ink, 'center')
    ctx.fillStyle = ink; ctx.fillRect(x, H - bottom * .78, w, Math.max(1, s * .006))
    inkText(ctx, 'UNDERGROUND', x, H - bottom * .46, bottom * .31, ink, 'left', w * .72)
    inkText(ctx, 'PHOTO CLUB', x, H - bottom * .16, bottom * .13, ink)
    ctx.save(); ctx.translate(W - x * .45, y + h * .5); ctx.rotate(Math.PI / 2)
    inkText(ctx, 'ORIGINAL PRINT / NO REPRINT', 0, 0, x * .22, ink, 'center', h * .7); ctx.restore()
    for (let i = 0; i < 19; i++) { ctx.fillStyle = ink; ctx.fillRect(W - x - s * .16 + i * s * .008, H - bottom * .52, s * (i % 3 ? .003 : .006), bottom * .35) }
  }
  if (recipe.frame === 'aged') {
    ctx.fillStyle = '#56412b40'
    for (let i = 0; i < 38; i++) ctx.fillRect(noise(i, 10) * W, 0, Math.max(1, s * .001), H)
    inkText(ctx, 'FIELD NOTES', x, y * .5, y * .42, '#3c2b1d')
    inkText(ctx, '004', W - x, y * .5, y * .52, '#3c2b1d', 'right')
    stamp(ctx, x + bottom * .9, H - bottom * .52, bottom * .78, 'ARCHIVE', '#8d281f')
    inkText(ctx, 'COLLECTED / LINSHE', W - x, H - bottom * .42, bottom * .17, '#3c2b1d', 'right', w * .54)
    ctx.strokeStyle = '#4a3525'; ctx.lineWidth = Math.max(1, s * .002)
    ctx.strokeRect(x * .5, y * .25, W - x, H - y * .5)
  }
  if (recipe.frame === 'journal') {
    const tile = Math.max(3, s * .035)
    for (let py = 0; py < H; py += tile) for (let px = 0; px < W; px += tile) {
      if ((Math.round(px / tile) + Math.round(py / tile)) % 2 === 0) { ctx.fillStyle = '#253d39'; ctx.fillRect(px, py, tile, tile) }
    }
    ctx.fillStyle = '#f8ebd1'; ctx.fillRect(x * .6, y * .65, W - x * 1.2, H - y * .85)
    const tape = (cx, cy, rotation, color) => {
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(rotation)
      ctx.fillStyle = color; ctx.fillRect(-s * .17, -s * .035, s * .34, s * .07)
      ctx.strokeStyle = '#ffffff80'; ctx.lineWidth = Math.max(1, s * .002)
      for (let i = -.16; i < .17; i += .025) { ctx.beginPath(); ctx.moveTo(s * i, -s * .035); ctx.lineTo(s * (i + .026), s * .035); ctx.stroke() }
      ctx.restore()
    }
    tape(W * .24, y * .5, -.13, '#ff7139'); tape(W * .78, y * .48, .14, '#9ecbc2')
    ctx.save(); ctx.translate(x * .4, H - bottom * .75); ctx.rotate(-.07)
    ctx.fillStyle = '#d9f33a'; ctx.fillRect(0, -s * .025, s * .3, s * .065)
    inkText(ctx, 'GOOD TIMES', s * .015, s * .008, s * .036, ink, 'left', s * .27); ctx.restore()
    caption(ctx, recipe.caption, W / 2, H - bottom * .37, w * .88, s * .04, ink)
    stamp(ctx, W - x - bottom * .37, H - bottom * .73, bottom * .32, 'LOVE', '#d1432e')
  }
  if (recipe.frame === 'gallery') {
    ctx.fillStyle = ink; ctx.fillRect(0, 0, x * .3, H); ctx.fillRect(0, H - bottom * .87, W, bottom * .87)
    inkText(ctx, 'EDITION / 006', x, y * .48, y * .37, ink)
    inkText(ctx, 'LNSH.', x, H - bottom * .48, bottom * .68, acid, 'left', w * .65)
    inkText(ctx, 'ART', W - x, H - bottom * .52, bottom * .24, acid, 'right')
    inkText(ctx, 'PRINT', W - x, H - bottom * .26, bottom * .2, acid, 'right')
    ctx.save(); ctx.translate(W - x * .5, y + h * .5); ctx.rotate(-Math.PI / 2)
    inkText(ctx, 'THE MOMENT IS YOURS', 0, 0, x * .31, ink, 'center', h * .8); ctx.restore()
  }
  if (recipe.frame === 'comic') {
    ctx.fillStyle = '#181623'
    for (let i = 0; i < 28; i++) {
      const angle = i * Math.PI / 14, outer = Math.max(W, H) * 1.2
      ctx.beginPath(); ctx.moveTo(W / 2 + Math.cos(angle) * s * .4, H / 2 + Math.sin(angle) * s * .4)
      ctx.lineTo(W / 2 + Math.cos(angle - .025) * outer, H / 2 + Math.sin(angle - .025) * outer)
      ctx.lineTo(W / 2 + Math.cos(angle + .025) * outer, H / 2 + Math.sin(angle + .025) * outer); ctx.closePath(); ctx.fill()
    }
    ctx.fillStyle = '#ec356d'; ctx.fillRect(x * .7, y * .18, w * .65, y * .65)
    inkText(ctx, 'WOW!!', x, y * .5, y * .55, '#fff8e5', 'left', w * .57)
    ctx.fillStyle = '#fff8e5'; ctx.fillRect(x, H - bottom * .82, w, bottom * .62)
    inkText(ctx, 'THIS IS MY SCENE!', x + w * .04, H - bottom * .5, bottom * .28, ink, 'left', w * .92)
    ctx.strokeStyle = ink; ctx.lineWidth = s * .009; ctx.strokeRect(x - s * .012, y - s * .012, w + s * .024, h + s * .024)
  }
  if (recipe.frame === 'arcade') {
    for (let j = 0; j < 3; j++) {
      ctx.strokeStyle = ['#fe3dc8', '#43edff', '#ad6bff'][j]; ctx.lineWidth = Math.max(1, s * .006)
      const inset = s * (.014 + j * .014); ctx.strokeRect(inset, inset, W - inset * 2, H - inset * 2)
    }
    inkText(ctx, 'PLAYER 01', W / 2, y * .57, y * .4, '#43edff', 'center', w * .85)
    inkText(ctx, 'INSERT COIN', W / 2, H - bottom * .55, bottom * .31, '#ff50c9', 'center')
    inkText(ctx, '★  ★  ★  HIGH SCORE  ★  ★  ★', W / 2, H - bottom * .23, bottom * .12, '#faff93', 'center', w * .9)
    for (let i = 0; i < 8; i++) { ctx.fillStyle = i % 2 ? '#ff50c9' : '#43edff'; ctx.fillRect(x * .3, y + i * h / 8, x * .27, x * .27); ctx.fillRect(W - x * .57, y + i * h / 8, x * .27, x * .27) }
  }
  if (recipe.frame === 'hazard') {
    ctx.save(); ctx.strokeStyle = ink; ctx.lineWidth = s * .035
    for (let i = -H; i < W; i += s * .075) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + H, H); ctx.stroke() }
    ctx.restore(); ctx.fillStyle = ink; ctx.fillRect(x * .8, y * .15, w + x * .4, y * .65); ctx.fillRect(x * .8, H - bottom * .85, w + x * .4, bottom * .7)
    inkText(ctx, 'CAUTION / LIVE SHOT', W / 2, y * .48, y * .3, '#ffd534', 'center', w * .9)
    inkText(ctx, 'DO NOT DISTURB', W / 2, H - bottom * .49, bottom * .29, '#ffd534', 'center', w * .9)
  }
  if (recipe.frame === 'vinyl') {
    ctx.strokeStyle = '#393432'; ctx.lineWidth = Math.max(1, s * .002)
    for (let i = 0; i < 25; i++) { ctx.beginPath(); ctx.arc(W * .5, H * .5, s * (.32 + i * .025), 0, Math.PI * 2); ctx.stroke() }
    ctx.fillStyle = '#ee4d32'; ctx.fillRect(x * .2, y * .18, W - x * .4, y * .55)
    inkText(ctx, 'LINSHE RECORDS', W / 2, y * .45, y * .34, '#f8edda', 'center', w * .9)
    ctx.fillStyle = '#22262a'; ctx.fillRect(0, H - bottom * .9, W, bottom * .9)
    inkText(ctx, 'SIDE A', x, H - bottom * .53, bottom * .52, '#f5d64d', 'left', w * .62)
    inkText(ctx, '33⅓ RPM', W - x, H - bottom * .5, bottom * .2, '#f8edda', 'right')
    inkText(ctx, 'A MOMENT ON REPEAT', x, H - bottom * .15, bottom * .12, '#f8edda')
  }
  drawThemedFrame(ctx, recipe, { x, y, w, h, W, H, s, bottom }, { inkText, caption, noise, createPath })
  drawSpecialFrame(ctx, recipe, { x, y, w, h, W, H, s, bottom }, { inkText, noise })
  if (!['none', 'classic', 'polaroid'].includes(recipe.frame)) {
    ctx.save()
    // New die-cut shells keep their transparent silhouette when paper grain is added.
    if (recipe.frame !== 'terrazzo' && SPECIAL_FRAME_PRESETS.some(item => item.value === recipe.frame)) ctx.globalCompositeOperation = 'source-atop'
    // Fixed photocopy grain gives the paper/ink surface a printed, imperfect edge.
    for (let i = 0; i < 5200; i++) {
      ctx.fillStyle = i % 2 ? '#241c1520' : '#fff9e51c'
      ctx.fillRect(noise(i, 7) * W, noise(i, 8) * H, Math.max(1, s * .0015), Math.max(1, s * .002))
    }
    ctx.restore()
  }
  ctx.restore()
}
