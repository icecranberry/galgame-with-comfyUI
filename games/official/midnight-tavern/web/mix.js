(() => {
  'use strict';
  const bases = [
    { id: 'gin_vodka', label: '烈酒', name: '金酒／伏特加', color: '#d39057', english: 'warm copper', tipsy: 38, chaos: 34, affinity: 2, fallback: '夜航' },
    { id: 'whiskey_rum', label: '陈酿', name: '威士忌／朗姆', color: '#a66544', english: 'rich cognac amber', tipsy: 23, chaos: 16, affinity: 3, fallback: '旧街回声' },
    { id: 'liqueur_sparkling', label: '微甜', name: '利口酒／气泡酒', color: '#e69588', english: 'rose gold', tipsy: 12, chaos: 8, affinity: 5, fallback: '灯下浮光' },
    { id: 'coffee_tea', label: '无酒精', name: '浓缩咖啡／热茶', color: '#b47756', english: 'tea caramel', tipsy: -100, chaos: 0, affinity: 2, fallback: '天亮以前' },
  ];
  const potions = [
    { id: 'charm', label: '魅力', name: '魅粉', color: '#e98cbb', english: 'rose pink' },
    { id: 'agility', label: '敏捷', name: '风青', color: '#76c8ae', english: 'mint green' },
    { id: 'strength', label: '武力', name: '烈红', color: '#ee766d', english: 'ember red' },
    { id: 'insight', label: '洞察', name: '星蓝', color: '#83aaf2', english: 'luminous blue' },
    { id: 'luck', label: '幸运', name: '琥珀金', color: '#efbb6b', english: 'amber gold' },
  ];
  const garnishes = [
    { id: 'rosemary', label: '迷迭香', effect: '冷静克制', symbol: '❧', color: '#9fbe82', chaos: -10 },
    { id: 'popping_candy', label: '跳跳糖', effect: '突发变数', symbol: '✺', color: '#e6a9ca', chaos: 23 },
    { id: 'chili', label: '辣椒片', effect: '热血暴走', symbol: '♨', color: '#e98a73', chaos: 22 },
    { id: 'butterfly_pea', label: '蝶豆花', effect: '意外反转', symbol: '✿', color: '#9ba2f0', chaos: 15 },
    { id: 'gold_leaf', label: '金箔', effect: '豪横排场', symbol: '✦', color: '#f2d283', chaos: 8 },
    { id: 'lime_wheel', label: '青柠轮片', effect: '清酸果香', color: '#b9d979', chaos: 0 },
    { id: 'cocktail_cherry', label: '酒渍樱桃', effect: '浓甜果香', color: '#e87283', chaos: 0 },
    { id: 'mint_sprig', label: '薄荷嫩枝', effect: '清凉草香', color: '#86c397', chaos: 0 },
    { id: 'cinnamon_stick', label: '肉桂卷', effect: '温暖辛香', color: '#d09161', chaos: 0 },
    { id: 'starfruit', label: '杨桃星片', effect: '清甜微酸', color: '#f2ce70', chaos: 0 },
  ];
  const clamp = (x, min, max) => Math.max(min, Math.min(x, max));
  const get = (choices, id) => choices.find(item => item.id === id);
  const ingredientText = value => [...value.trim()].slice(0, 20).join('');
  const base = recipe => get(bases, recipe.baseLiquor);
  const empty = () => ({ baseLiquor: '', potions: [], mixedDrops: 0, iceCount: 0, garnish: '', customIngredient: '' });
  // Historic recipes use stat IDs. A custom drop freezes its interpretation when poured.
  function dose(value) {
    if (typeof value === 'string') return get(potions,value);
    const stat=get(potions,value?.stat);
    if (!stat || typeof value.name!=='string' || !/^#[0-9a-f]{6}$/i.test(value.color)) return null;
    return {...stat,name:ingredientText(value.name),color:value.color,english:value.color};
  }
  function localPotion(name) {
    const families=[
      ['luck',/幸运|许愿|祝福|锦鲤|四叶|好运|luck|wish/i],
      ['agility',/风|迅|速|闪|敏|疾|飞|轻盈|薄荷|wind|swift|mint/i],
      ['strength',/烈|火|焰|龙|力|熔|雷|狂|岩|辣|flame|fire|strength/i],
      ['charm',/魅|爱|玫瑰|甜|樱|歌|香|温柔|rose|love|charm/i],
      ['insight',/月|星|夜|冰|露|梦|智|记忆|眼|真|海|moon|dream|insight/i],
    ];
    const stat=families.find(([,rule])=>rule.test(name))?.[0] || 'insight';
    const hues=[
      ['#975de5',/紫|薰衣草|葡萄|violet|purple/i],['#48d8d1',/青|碧|薄荷|teal|mint/i],
      ['#74bf66',/绿|叶|森林|翡翠|green|forest/i],['#649aed',/蓝|冰|海|星空|blue|ice/i],
      ['#f0be55',/金|琥珀|蜂蜜|gold|amber/i],['#f190ba',/粉|樱|玫瑰|pink|rose/i],
      ['#e36348',/红|血|火|熔岩|red|fire/i],['#d9dfe7',/银|白|月光|霜|white|silver/i],
      ['#554961',/黑|墨|暗影|black|shadow/i],
    ];
    const color=name.match(/#[0-9a-f]{6}\b/i)?.[0] || hues.find(([,rule])=>rule.test(name))?.[0] || get(potions,stat).color;
    return {name,stat,color};
  }
  function calculate(recipe) {
    const spirit = base(recipe);
    const garnish = get(garnishes, recipe.garnish);
    const ingredient = ingredientText(recipe.customIngredient);
    const quirky = /香菜|猫薄荷|螺蛳粉|榴莲|臭豆腐|鱼腥草|芥末|大蒜|酱油|醋|辣条|皮蛋|火锅|袜|牙膏|泥|石头|肥皂|鞋|墨水|洗衣|腌/.test(ingredient);
    const palette = [spirit || bases[1], ...recipe.potions.map(dose).filter(Boolean)];
    return {
      stats: Object.fromEntries(potions.map(({ id }) => [id, recipe.potions.filter(potion => dose(potion)?.id === id).length])),
      tipsyDelta: spirit?.tipsy || 0,
      affinityDelta: (spirit?.affinity || 0) + Number(Boolean(ingredient) && !quirky),
      chaos: clamp((spirit?.chaos || 0) + (garnish?.chaos || 0) + (quirky ? 34 : ingredient ? 3 : 0), 0, 100),
      palette: palette.map(item => item.color),
      colors: [...new Set(palette.map(item => item.english))],
    };
  }
  function recipeLabel(recipe) {
    const counts=new Map();
    for(const drop of recipe.potions) {
      const name=dose(drop)?.name;
      if(name) counts.set(name,(counts.get(name)||0)+1);
    }
    return [base(recipe)?.name,...Array.from(counts,([name,n])=>name+'×'+n),get(garnishes, recipe.garnish)?.label].filter(Boolean).join(' · ');
  }
  window.TavernMix = { bases, potions, garnishes, base, empty, get, dose, localPotion, clamp, calculate, ingredientText, recipeLabel };
})();
