export const workTypes = ['tracks', 'games', 'clips'];
export async function resolveAdminOwner(request, id, { types = workTypes, listed = [] } = {}) {
  if (typeof id !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)) throw new Error('指定作品编号无效，请从作品内容重新进入。');
  id = id.toLowerCase();
  const matches = (await Promise.all(types.map(async type => {
    try {
      const item = await request('/' + type + '/' + id);
      if (item.id !== id || item.type !== type) throw new Error('指定作品的读取结果不一致，已停止编辑。');
      const data = (item.draft ?? item.published)?.data;
      return { ...item, title: data?.metadata?.title?.[data.metadata.originalLocale] ?? item.slug ?? '指定作品' };
    } catch (error) {
      if (error.code === 'NOT_FOUND' && error.status === 404) return null;
      throw error;
    }
  }))).filter(Boolean);
  if (matches.length > 1) throw new Error('指定作品编号对应多份资料，已停止编辑，请联系维护者核对。');
  if (matches.length === 1) return matches[0];
  // Old tracks can own assets before their website publication is registered.
  // Only an exact native catalog match may supply that missing website object.
  if (types.includes('tracks')) {
    const known = listed.find(item => item.id === id && item.type === 'tracks');
    if (known?.status === 'unregistered') return known;
    let before = null;
    for (let page = 0; page < 50; page++) {
      const result = await request('/tracks' + (before ? '?before=' + encodeURIComponent(before) : ''));
      const item = result.items.find(item => item.id === id && item.status === 'unregistered');
      if (item) return { ...item, type: 'tracks' };
      if (!result.nextBefore) break;
      if (result.nextBefore === before) throw new Error('作品列表分页未推进，已停止定位。');
      before = result.nextBefore;
      if (page === 49) throw new Error('指定作品超过本次定位范围，请从作品内容重新进入。');
    }
  }
  throw new Error('没有找到指定作品，已停止素材与内容编辑。请核对入口或回到作品内容重新选择。');
}
export function catalogRows(pages, filter = 'all') {
  return (filter === 'all' ? workTypes : workTypes.filter(type => type === filter)).flatMap(type => (pages[type]?.items ?? []).map(item => ({ ...item, type }))).filter(item=>filter!=='all'||(item.status!=='unregistered'&&item.legacyLifecycle!=='archived')).sort((a,b)=>Number(a.status==='unregistered'||a.legacyLifecycle==='archived')-Number(b.status==='unregistered'||b.legacyLifecycle==='archived'));
}
export function catalogHasMore(pages, filter = 'all') {
  return (filter === 'all' ? workTypes : workTypes.filter(type => type === filter)).some(type => Boolean(pages[type]?.nextBefore));
}
export function listAssetState(item) {
  const assets = item.assetDetails ?? [];
  if (!assets.length || assets.length < item.expectedAssetCount || assets.some(asset => asset.state !== 'validated')) return 'missing';
  if (assets.some(asset => asset.rightsStatus === 'blocked')) return 'blocked';
  return assets.every(asset => asset.rightsStatus === 'approved') ? 'approved' : 'pending';
}
export function adminImagePath(type, id) {
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id ?? '')) return null;
  return type === 'tracks' ? '/admin/api/music/assets/' + id : '/admin/api/music/site-content/assets/' + id + '/image';
}
export function adminListImage(item, type) {
  const kind = { tracks: 'cover', games: 'game_screenshot', clips: 'poster' }[type];
  return item.assetDetails?.some(asset => asset.id === item.imageId && asset.kind === kind && asset.state === 'validated')
    ? adminImagePath(type, item.imageId) : null;
}
export function publicationFormReady({ identity, busy, pending, dirty, current, assets, type }) {
  if (!identity || identity.role !== 'publisher' || busy || pending || dirty || !current?.draft) return false;
  const data = current.draft.data;
  const ids = type === 'tracks' ? [data.coverAssetId, data.lyricsAssetId].filter(Boolean)
    : type === 'games' ? data.screenshotIds ?? [] : type === 'clips' ? [data.mediaAssetId, data.posterAssetId].filter(Boolean) : [];
  if ((type==='tracks'&&!data.coverAssetId)||(type==='clips'&&(!data.mediaAssetId||!data.posterAssetId))||(['tracks', 'games', 'clips'].includes(type) && !ids.length)) return false;
  return ids.every(id => assets.some(a => a.id === id && a.state === 'validated' && a.rightsStatus === 'approved'));
}
