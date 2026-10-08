import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
export async function stationGameMaterials() {
  const screenshotPath = fileURLToPath(new URL('../../docs/station-cat-redesign/T03-evidence/cat-life-desktop.png', import.meta.url));
  const bytes = await readFile(screenshotPath);
  const metadata = { originalLocale: 'zh-Hans',
    title: { 'zh-Hant': '打工養貓日記', 'zh-Hans': '打工养猫日记', en: 'Cat Life Diary', ja: '働きながら猫と暮らす日記' },
    summary: { 'zh-Hant': '在小鎮裡工作、佈置家，照顧每一隻陪你生活的貓咪。', 'zh-Hans': '在小镇里工作、布置家，照顾每一只陪你生活的猫咪。', en: 'Work in a small town, make a home, and care for the cats who share your days.', ja: '小さな町で働き、家を整え、一緒に暮らす猫たちをお世話しましょう。' } };

  // These records exist only in disposable local D1/R2. Rights metadata is a fixture,
  // not evidence that production screenshot approval has been configured.
  return { screenshotPath, metadata, screenshotSha256: createHash('sha256').update(bytes).digest('hex') };
}
