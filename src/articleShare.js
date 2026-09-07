import qrcode from 'qrcode-generator';

export const articleShareCopy = (locale) => ({
  'zh-Hant': { open: '分享卡片', title: '分享這篇文章', close: '關閉', save: '儲存圖片', share: '分享圖片', copy: '複製連結', copied: '連結已複製', loading: '正在製作卡片…', failed: '卡片製作失敗，請重試。', retry: '重試', ready: '分享卡片已準備好', scan: '掃碼閱讀全文', hint: '長按圖片儲存，再分享到朋友圈或微信群。', manual: '請選取下方連結複製。', shareFailed: '無法開啟分享，請儲存圖片。' },
  'zh-Hans': { open: '分享卡片', title: '分享这篇文章', close: '关闭', save: '保存图片', share: '分享图片', copy: '复制链接', copied: '链接已复制', loading: '正在制作卡片…', failed: '卡片制作失败，请重试。', retry: '重试', ready: '分享卡片已准备好', scan: '扫码阅读全文', hint: '长按图片保存，再分享到朋友圈或微信群。', manual: '请选择下方链接复制。', shareFailed: '无法打开分享，请保存图片。' },
  en: { open: 'Share card', title: 'Share this article', close: 'Close', save: 'Save image', share: 'Share image', copy: 'Copy link', copied: 'Link copied', loading: 'Preparing your card…', failed: 'Could not create the card. Please retry.', retry: 'Retry', ready: 'Share card ready', scan: 'Scan to read', hint: 'Save the image to share in WeChat Moments or a group chat.', manual: 'Select and copy the link below.', shareFailed: 'Sharing is unavailable. Please save the image.' },
  ja: { open: 'シェアカード', title: 'この記事をシェア', close: '閉じる', save: '画像を保存', share: '画像をシェア', copy: 'リンクをコピー', copied: 'コピーしました', loading: 'カードを作成中…', failed: 'カードを作成できませんでした。再試行してください。', retry: '再試行', ready: 'シェアカードを作成しました', scan: 'スキャンして読む', hint: '画像を保存して、WeChatのモーメンツやグループにシェアできます。', manual: '下のリンクを選択してコピーしてください。', shareFailed: 'シェアできません。画像を保存してください。' }
}[locale] || articleShareCopy('zh-Hant'));

// QR targets always use the website's canonical article wrapper, including link-only articles.
export function articleShareData(row, basePath) {
  if (!/^\/(?:en\/|ja\/|zh-hans\/)?signal\/$/.test(basePath) || !/^x-(?:article|post)-\d{1,25}$/.test(row.slug)) return null;
  const url = `https://wwwstationcat.org${basePath}${row.slug}/`;
  const qr = qrcode(0, 'M');
  qr.addData(url);
  qr.make();
  const size = qr.getModuleCount();
  // A bounded matrix avoids injecting SVG/HTML and keeps the four-module quiet zone explicit.
  const modules = Array.from({ length: size }, (_, y) => Array.from({ length: size }, (_, x) => qr.isDark(y, x) ? '1' : '0').join(''));
  return { url, title: String(row.title || '').slice(0, 240), description: String(row.description || '').slice(0, 1200), date: String(row.published_at || row.updated_at || '').slice(0, 10), modules };
}
