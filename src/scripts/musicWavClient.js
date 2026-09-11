import { WAV_PROFILE, WAV_LIMITS, isWav } from './musicWav.js';

export function createWavConverter({ createWorker = () => new Worker(new URL('./musicWavWorker.js', import.meta.url), { type: 'module' }), timeoutMs = 600000 } = {}) {
  let active;
  function cancel() { active?.(new Error('已取消转换。本次未发送文件，已有上传会话仍保留，可重新选择文件后重试。')); }
  function convert(file, kind, progress = () => {}) {
    if (active) return Promise.reject(new Error('请先完成或取消当前转换。'));
    if (!isWav(file) || !['audio', 'preview'].includes(kind) || file.size < 44 || file.size > WAV_LIMITS[kind]) {
      return Promise.reject(new Error('请选择符合限制的 WAV：完整音频最大 256 MiB，试听最大 32 MiB。'));
    }
    return new Promise((resolve, reject) => {
      let worker, timer, settled = false;
      const finish = (error, result) => {
        if (settled) return;
        settled = true; clearTimeout(timer); active = null;
        if (worker) { worker.onmessage = worker.onerror = worker.onmessageerror = null; worker.terminate(); }
        if (error) reject(error); else resolve(result);
      };
      active = finish;
      try {
        worker = createWorker();
        timer = setTimeout(() => finish(new Error('转换超时，已停止。请缩短文件后重试。')), timeoutMs);
        worker.onerror = worker.onmessageerror = () => finish(new Error('转换组件不可用，已停止。请重试或在本机导出 MP3 后上传。'));
        worker.onmessage = ({ data }) => {
          if (settled) return;
          if (data.error) finish(new Error(data.error));
          else if (data.result) {
            const r = data.result;
            if (!(r.blob instanceof Blob) || !r.blob.size || r.blob.size > (kind === 'audio' ? 32 : 4) * 1048576 || r.profile !== WAV_PROFILE) {
              finish(new Error('转换结果无效，请重试。')); return;
            }
            finish(null, { ...r, file: new File([r.blob], file.name.replace(/\.wav$/i, '.mp3'), { type: 'audio/mpeg', lastModified: 0 }) });
          } else if (Number.isInteger(data.percent) && data.percent >= 0 && data.percent <= 100) progress(data.percent);
        };
        worker.postMessage({ file, kind });
      } catch { finish(new Error('此浏览器无法启动转换组件，请在本机导出 MP3 后上传。')); }
    });
  }
  return { convert, cancel };
}
