// Local preview only. No production bindings, customer data, or upstream fetches.
export function createServicePreviewFixture() {
  const accounts = [1, 2, 3].map(id => ({ id, email: `reader0${id}@example.com`, status: 'active', creditAccount: { balanceCredits: id === 1 ? 90 : 0, unitLabel: 'Station Points' }, stats: { orderCount: id === 1 ? 5 : 0, activeEntitlementCount: 0, latestOrderAt: id === 1 ? '2026-10-13T01:30:00Z' : null } }));
  const orders = ['finished','failed','failed','refunded','finished'].map((status,index) => ({ id: 5-index, orderToken: `SC-1013-00${5-index}`, status, orderType: 'credit-pack', priceAmount: index === 4 ? 1 : 10, priceCurrency: 'USD', payAmount: index === 4 ? 1 : 10, payCurrency: 'USD', accountEmail: `reader0${index+1}@example.com`, createdAt: `2026-10-${String(13-index).padStart(2,'0')}T01:30:00Z`, updatedAt: `2026-10-${String(13-index).padStart(2,'0')}T01:32:00Z`, providerStatus: status, providerPaymentId: `preview-${index}` }));
  orders[2].orderToken = 'sc-preview-very-long-order-token-7a6b5c4d3e2f1';
  accounts[2].email = 'a.long.account.name.for.layout.checks@example.com';
  const ledgers = new Map();
  const detail = account => ({ account, credits: account.creditAccount, membership: { active:false }, membershipSettings: { membershipCreditCost:10 }, creditLedger: ledgers.get(account.id) || [], entitlements: [], orders: account.id===1 ? orders : [] });
  const paths = new Set(['/admin/api/novels/payments/orders','/admin/api/novels/payments/order','/admin/api/novels/readers/accounts','/admin/api/novels/readers/account','/admin/api/novels/readers/credits/adjust','/admin/api/content/audit-logs']);
  return { accepts: path => paths.has(path), async handle(request) {
    const url = new URL(request.url), p = url.pathname, q = url.searchParams;
    const json = (data,status=200) => Response.json({ok:status===200,...data},{status});
    if (request.method === 'POST' && p.endsWith('/credits/adjust')) {
      const data = await request.json(), account = accounts.find(a=>a.id===Number(data.accountId));
      if (!account || !Number.isInteger(data.creditsDelta) || !data.note?.trim()) return json({error:'Invalid preview adjustment'},400);
      account.creditAccount.balanceCredits += data.creditsDelta;
      const ledger = ledgers.get(account.id) || []; ledger.unshift({creditsDelta:data.creditsDelta,balanceAfter:account.creditAccount.balanceCredits,entryType:'manual',source:'local preview',note:data.note,createdAt:'2026-10-13T01:35:00Z'});ledgers.set(account.id,ledger);
      return json(detail(account));
    }
    if (request.method !== 'GET') return json({error:'Preview method unavailable'},405);
    if (p.endsWith('/payments/orders')) return json({orders:orders.filter(o=>(!q.get('email')||o.accountEmail===q.get('email'))&&(!q.get('status')||o.status===q.get('status'))&&(!q.get('orderType')||o.orderType===q.get('orderType'))&&(!q.get('series')))});
    if (p.endsWith('/payments/order')) {
      const order=orders.find(o=>o.orderToken===q.get('order')||String(o.id)===q.get('id'));
      return order ? json({order,fulfillment:{complete:order.status==='finished',needsReview:order.status==='failed'},events:order.status==='finished'?[{status:'finished',signatureValid:true,providerPaymentId:order.providerPaymentId,receivedAt:order.updatedAt}]:[]}) : json({error:'Not found'},404);
    }
    if (p.endsWith('/readers/accounts')) return json({accounts:accounts.filter(a=>(!q.get('email')||a.email===q.get('email'))&&(!q.get('status')||a.status===q.get('status')))});
    if (p.endsWith('/readers/account')) { const account=accounts.find(a=>String(a.id)===q.get('id'));return account?json(detail(account)):json({error:'Not found'},404); }
    return json({logs:[]});
  }};
}
