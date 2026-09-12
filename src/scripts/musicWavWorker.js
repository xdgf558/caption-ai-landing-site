import { encodeWav } from './musicWav.js';

// Kept separate and unmodified so the LGPL encoder can be inspected/replaced.
const encoderUrl = '/vendor/music-mp3/lamejs-1.2.7.js';
self.onmessage = async ({ data }) => {
  try {
    const { Mp3Encoder } = await import(/* @vite-ignore */ encoderUrl);
    const result = await encodeWav(data.file, data.kind, Mp3Encoder, percent => self.postMessage({ percent }));
    self.postMessage({ result });
  } catch (error) { self.postMessage({ error: error.message || '转换失败，请重新选择文件。' }); }
};
