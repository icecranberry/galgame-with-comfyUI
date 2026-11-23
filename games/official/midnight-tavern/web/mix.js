(() => {
  'use strict';
  const {
    primaryPotions, compoundPotions, MAX_DROPS, BASE_TIPSY, intoxication, predictTipsy, canServeDrink,
    potionDose: dose, potionAttributes, drinkEffects, recipeEffects, recipeName, garnishes,
  } = window.TavernAppearance;
  const bases = [
    { id: 'gin_vodka', label: '烈酒', name: '金酒／伏特加', color: '#d39057', english: 'warm copper' },
    { id: 'whiskey_rum', label: '陈酿', name: '威士忌／朗姆', color: '#a66544', english: 'rich cognac amber' },
    { id: 'liqueur_sparkling', label: '微甜', name: '利口酒／气泡酒', color: '#e69588', english: 'rose gold' },
    { id: 'coffee_tea', label: '无酒精', name: '浓缩咖啡／热茶', color: '#b47756', english: 'tea caramel' },
  ].map(item => ({ ...item, tipsyDelta: BASE_TIPSY[item.id] }));
  const potions = [...primaryPotions, ...compoundPotions];
  const get = (choices, id) => choices.find(item => item.id === id);
  const base = recipe => get(bases, recipe.baseLiquor);
  const empty = () => ({ baseLiquor: '', potions: [], mixedDrops: 0, iceCount: 0, garnish: '' });
  const tipsyEffectLabel = amount => amount ? `酒劲 ${amount > 0 ? '+' : '−'}${Math.abs(amount)}` : '酒劲抵消';
  const attributeLabels = attributes => Object.entries(potionAttributes)
    .flatMap(([key, name]) => attributes[key] ? [`${name} +${attributes[key]}`] : []);
  function potionLabels(potion) {
    const labels = attributeLabels(potion.attributes);
    if (potion.tipsyDelta) labels.push(tipsyEffectLabel(potion.tipsyDelta));
    return labels;
  }
  function recipeParts(recipe) {
    const counts=new Map();
    for(const drop of recipe.potions) {
      const name=dose(drop)?.name;
      if(name) counts.set(name,(counts.get(name)||0)+1);
    }
    return [base(recipe)?.name,...Array.from(counts,([name,n])=>name+'×'+n),get(garnishes, recipe.garnish)?.label].filter(Boolean);
  }
  const recipeLabel = recipe => recipeParts(recipe).join(' · ');
  window.TavernMix = {
    bases, potions, garnishes, base, empty, get, dose, recipeLabel, recipeParts,
    intoxication, predictTipsy, canServeDrink, drinkEffects, recipeEffects, recipeName,
    potionAttributes, attributeLabels, potionLabels, tipsyEffectLabel, maxDrops: MAX_DROPS,
  };
})();
