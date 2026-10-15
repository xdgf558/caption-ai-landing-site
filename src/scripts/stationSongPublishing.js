// The website publishes its own presentation. The legacy audio draft is never
// submitted for technical review or publication by this workflow.
export async function publishWebsiteSong({ controller, current, data, assets, confirmRights, saveDraft, reload }) {
  const owner = current?.id;
  const selected = [data.coverAssetId, data.lyricsAssetId].filter(Boolean);
  if (!data.coverAssetId) throw new Error('请先添加歌曲封面。');
  const approvals = selected.map(id => {
    const asset = assets.find(a => a.id === id);
    if (!asset || asset.state !== 'validated') throw new Error('所选素材尚未上传完成，请先核对上传结果。');
    if (asset.rightsStatus === 'blocked') throw new Error('所选素材已被禁止公开，请更换素材或在素材权利中处理。');
    return asset;
  }).filter(a => a.rightsStatus !== 'approved');
  if (approvals.length && !confirmRights) throw new Error('请确认封面和选用歌词可用于网站展示。');
  await controller.verifyActor();
  const saved = await saveDraft();
  if (!saved?.id || (owner && saved.id !== owner)) throw new Error('歌曲已变化，已停止发布。');
  for (const asset of approvals) await controller.mutate('/assets/' + asset.id + '/rights', 'PUT', {
    scope: asset.kind, status: 'approved', basis: '管理员确认：此素材为本人原创或已获授权，可用于本歌曲的网站展示。'
  }, asset.rightsVersion || 1);
  const draft = saved.draft;
  if (!draft) throw new Error('没有可发布的修改，请重新读取歌曲。');
  await controller.mutate('/tracks/' + saved.id + '/publish', 'POST', { revision: draft.revision }, saved.editVersion);
  await reload(saved.id);
}

export function savedSongCover(data, current, assets) {
  // Only suggest the explicitly saved cover of this same legacy track. Never
  // select an arbitrary uploaded file or replace an existing website cover.
  const id = current?.savedMusicAssets?.cover;
  return !data.coverAssetId && !current?.published && assets.some(a => a.id === id && a.kind === 'cover' && a.state === 'validated') ? id : data.coverAssetId ?? null;
}
