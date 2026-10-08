// Compose existing screenshots only; never redraw or generate product artwork.
import sharp from 'sharp';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const evidence = new URL('../T14-evidence/', import.meta.url);
const path = name => fileURLToPath(new URL(name, evidence));
const source = fileURLToPath(new URL('../T04-evidence/gentle-station/source.png', import.meta.url));
const files = ['guest-zh-hant-1440.png', 'member-zh-Hant-1440.png', 'member-zh-Hant-390.png',
  'member-zh-Hant-390-before-logout.png', ...['zh-hant', 'zh-hans', 'en', 'ja'].flatMap(locale =>
    ['1440', '360'].map(width => 'guest-' + locale + '-' + width + '.png'))];
const metadata = {};
for (const name of new Set(files)) { const { width, height } = await sharp(path(name)).metadata(); metadata[name] = { width, height }; }
metadata.source = { ...(await sharp(source).metadata()), crop: { left: 46, top: 72, width: 1356, height: 994 } };
// Compare the home reference to the new Member page at a common CSS scale.
// Content differs intentionally; brand, artwork and visual tokens are the scope.
const reference = await sharp(source).extract(metadata.source.crop).resize({ width: 600 }).png().toBuffer();
const guest = await sharp(path('guest-zh-hant-1440.png')).resize({ width: 600 }).png().toBuffer();
const member = await sharp(path('member-zh-Hant-1440.png')).resize({ width: 600 }).png().toBuffer();
const scaled = await Promise.all([reference, guest, member].map(data => sharp(data).metadata()));
await sharp({ create: { width: 1832, height: Math.max(...scaled.map(info => info.height)) + 16, channels: 3, background: '#f0f0f7' } })
  .composite([{ input: reference, left: 8, top: 8 }, { input: guest, left: 616, top: 8 }, { input: member, left: 1224, top: 8 }])
  .png().toFile(path('comparison-brand-and-member.png'));
const refHeader = await sharp(source).extract({ left: 46, top: 72, width: 1356, height: 61 }).resize({ width: 1200 }).png().toBuffer();
const memberHeader = await sharp(path('guest-zh-hant-1440.png')).extract({ left: 0, top: 0, width: 1425, height: 64 }).resize({ width: 1200 }).png().toBuffer();
await sharp({ create: { width: 1216, height: 140, channels: 3, background: '#f0f0f7' } })
  .composite([{ input: refHeader, left: 8, top: 8 }, { input: memberHeader, left: 8, top: 78 }])
  .png().toFile(path('comparison-header.png'));
const phoneBefore = await sharp(path('member-zh-Hant-390-before-logout.png')).extract({ left: 0, top: 0, width: 375, height: 844 }).png().toBuffer();
const phoneAfter = await sharp(path('member-zh-Hant-390.png')).extract({ left: 0, top: 0, width: 375, height: 844 }).png().toBuffer();
await sharp({ create: { width: 774, height: 860, channels: 3, background: '#f0f0f7' } })
  .composite([{ input: phoneBefore, left: 8, top: 8 }, { input: phoneAfter, left: 391, top: 8 }])
  .png().toFile(path('comparison-mobile-account.png'));
await sharp(path('guest-zh-hant-1440.png')).extract({ left: 0, top: 0, width: 1425, height: 900 })
  .png().toFile(path('guest-desktop-viewport.png'));
await writeFile(path('image-metadata.json'), JSON.stringify({ ...metadata,
  comparison: { source: 'home reference: browser frame removed', desktop: 'Member guest/current-account: 1425px content in 1440px viewport; common width 600px',
    header: 'Reference above, implementation below; common width 1200px', mobile: 'Before fix left, after fix right; same current member, 390px viewport, 375px raster content, 844px top crop; fixture dates differ' } }, null, 2) + '\n');
console.log('T14 screenshot comparisons composed from original pixels.');
