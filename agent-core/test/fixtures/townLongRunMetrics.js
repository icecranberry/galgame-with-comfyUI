// Derive reporting metrics from actual runtime observations, never simulate flows.
export function summarizeReplay(result) {
  return Object.fromEntries([30,90].map(days => {
    const rows=result.daily.slice(0,days),last=rows.at(-1);
    const averageSupplier=rows.reduce((sum,row)=>sum+row.inventory.supplier,0)/days;
    const roles=['commissioner','fund','supplier','workshop'];
    let previous=Object.fromEntries(roles.map(role=>[role,false]));
    const episodes=Object.fromEntries(roles.map(role=>[role,0]));
    for(const row of rows)for(const role of roles) {
      const empty=row.money[role]===0;
      if(empty&&!previous[role])episodes[role]++;
      previous[role]=empty;
    }
    const delivered=last.orders.completed||0;
    return [days,{circulation:last.circulation,grossPolicyIssued:last.issued,reclaimed:last.reclaimed,
      delivered,servicesCompleted:last.services.completed||0,produced:last.production.completed||0,
      expiredProductionAttempts:last.production.expired||0,unpaidCompleted:last.unpaidCompleted,
      outstandingOrders:['open','accepted','picked_up'].reduce((n,status)=>n+(last.orders[status]||0),0),
      zeroBalanceEpisodes:episodes,bankruptcyCount:null,
      bankruptcyNote:'No bankruptcy/default transition exists; zero-balance episodes are a separate sampled proxy.',
      supplierZeroEndOfDayDays:rows.filter(row=>row.inventory.supplier===0).length,
      averageSupplierEndOfDay:averageSupplier,dispatchPerAverageSupplierStock:averageSupplier?delivered/averageSupplier:null,
      playerDeliveryIncome:delivered*30,
      firstPolicyIssueDay:rows.find(row=>row.issued>0)?.day??null,
      firstResourceEmptyDay:rows.find(row=>row.resource===0)?.day??null}];
  }));
}
