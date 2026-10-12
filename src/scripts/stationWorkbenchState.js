export const workTypes = ['tracks', 'games', 'clips'];
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
