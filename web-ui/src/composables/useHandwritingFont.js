const DEFAULT_FONT_ID = 'ma_shan_zheng'

const FONT_CATALOG = {
  // ── fonts.font.im (Google Fonts 国内镜像) ──
  ma_shan_zheng:    { family: "'Ma Shan Zheng'",      cssUrl: 'https://fonts.googleapis.cn/css2?family=Ma+Shan+Zheng&display=swap' },
  zcool_kuaile:     { family: "'ZCOOL KuaiLe'",       cssUrl: 'https://fonts.googleapis.cn/css2?family=ZCOOL+KuaiLe&display=swap' },
  liu_jian_mao_cao: { family: "'Liu Jian Mao Cao'",   cssUrl: 'https://fonts.googleapis.cn/css2?family=Liu+Jian+Mao+Cao&display=swap' },
  long_cang:        { family: "'Long Cang'",          cssUrl: 'https://fonts.googleapis.cn/css2?family=Long+Cang&display=swap' },
  zhi_mang_xing:    { family: "'Zhi Mang Xing'",      cssUrl: 'https://fonts.googleapis.cn/css2?family=Zhi+Mang+Xing&display=swap' },
  zcool_xiaowei:    { family: "'ZCOOL XiaoWei'",      cssUrl: 'https://fonts.googleapis.cn/css2?family=ZCOOL+XiaoWei&display=swap' },
  zcool_qingke:     { family: "'ZCOOL QingKe HuangYou'", cssUrl: 'https://fonts.googleapis.cn/css2?family=ZCOOL+QingKe+HuangYou&display=swap' },
  // ── jsdelivr / @chinese-fonts ──
  lxgw_wenkai:      { family: "'LXGW WenKai'",       cssUrl: 'https://cdn.jsdelivr.net/npm/@chinese-fonts/lxgwwenkai/dist/LXGWWenKai-Regular/result.css' },
  lxgw_wenkai_light:{ family: "'LXGW WenKai'",       cssUrl: 'https://cdn.jsdelivr.net/npm/@chinese-fonts/lxgwwenkai/dist/LXGWWenKai-Light/result.css' },
  lxgw_marker:      { family: "'LXGW Marker Gothic'",cssUrl: 'https://cdn.jsdelivr.net/npm/@chinese-fonts/lxgwmanhei/dist/LXGWMarkerGothic/result.css' },
  dyh:              { family: "'Smiley Sans'",        cssUrl: 'https://cdn.jsdelivr.net/npm/@chinese-fonts/dyh/dist/SmileySans-Oblique/result.css' },
  cef:              { family: "'CEF Fonts CJK'",     cssUrl: 'https://cdn.jsdelivr.net/npm/@chinese-fonts/cef/dist/CEFFontsCJK-Regular/result.css' },
  cubic:            { family: "'Cubic'",              cssUrl: 'https://cdn.jsdelivr.net/npm/@chinese-fonts/cubic/dist/Cubic/result.css' },
  yozai:            { family: "'Yozai'",              cssUrl: 'https://cdn.jsdelivr.net/npm/@chinese-fonts/yozai/dist/Yozai-Regular/result.css' },
  xiaolai:          { family: "'Xiaolai'",            cssUrl: 'https://cdn.jsdelivr.net/npm/@chinese-fonts/xiaolai/dist/Xiaolai/result.css' },
  moon_stars_kai:   { family: "'Moon Stars Kai'",     cssUrl: 'https://cdn.jsdelivr.net/npm/@chinese-fonts/moon-stars-kai/dist/MoonStarsKai-Regular/result.css' },
  chill_round:      { family: "'Chill Round F'",      cssUrl: 'https://cdn.jsdelivr.net/npm/@chinese-fonts/hcqyt/dist/ChillRoundFRegular/result.css' },
  yryxk:            { family: "'slideyouran'",        cssUrl: 'https://cdn.jsdelivr.net/npm/@chinese-fonts/ysyrxk/dist/slideyouran-Regular2.0/result.css' },
  lxgw_bright:      { family: "'LXGW Bright'",       cssUrl: 'https://cdn.jsdelivr.net/npm/@chinese-fonts/lxgwwenkaibright/dist/LXGWBright-Regular/result.css' },
  tiejili:          { family: "'Tiejili'",            cssUrl: 'https://cdn.jsdelivr.net/npm/@chinese-fonts/tjl/dist/Tiejili_Regular/result.css' },
  maoken:           { family: "'MaokenAssortedSans'", cssUrl: 'https://cdn.jsdelivr.net/npm/@chinese-fonts/mksjh/dist/MaokenAssortedSans/result.css' },
  zhuque_fangsong:  { family: "'Zhuque Fangsong'",   cssUrl: 'https://cdn.jsdelivr.net/npm/@chinese-fonts/zqfs/dist/ZhuqueFangsong-Regular/result.css' },
  honglei_xs:       { family: "'鸿雷行书简体'",      cssUrl: 'https://unpkg.com/@chinese-fonts/hlxsjt@3.0.0/dist/%E9%B8%BF%E9%9B%B7%E8%A1%8C%E4%B9%A6%E7%AE%80%E4%BD%93/result.css' },
}

const FALLBACK_STACK = "'STKaiti', 'KaiTi', serif"

const loadedFonts = new Set()

export function getFontFamily(fontId) {
  const font = FONT_CATALOG[fontId]
  if (!font) return `${FONT_CATALOG[DEFAULT_FONT_ID].family}, ${FALLBACK_STACK}`
  return `${font.family}, ${FALLBACK_STACK}`
}

export function getWriteFontFamily() {
  return `${FONT_CATALOG[DEFAULT_FONT_ID].family}, ${FALLBACK_STACK}`
}

export function getPageDefaultFontFamily() {
  return "'HarmonyOS Sans SC', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif"
}

export function loadFont(fontId) {
  if (!fontId) return
  const font = FONT_CATALOG[fontId]
  if (!font) return
  if (loadedFonts.has(fontId)) return

  loadedFonts.add(fontId)

  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = font.cssUrl
  document.head.appendChild(link)
}
