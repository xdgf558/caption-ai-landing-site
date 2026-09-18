// Reproducible local test audio; no third-party recording or runtime dependency.
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const binary=process.env.FFMPEG||'ffmpeg';
const run=args=>execFileSync(binary,['-hide_banner','-loglevel','error',...args],{maxBuffer:2*1024*1024});
const file='long-cbr.mp3',path='tests/fixtures/music-mp3/'+file;
const args=['-f','lavfi','-i','sine=frequency=330:sample_rate=44100:duration=180','-ac','1','-c:a','libmp3lame','-b:a','64k','-write_xing','1','-id3v2_version','3'];
run(['-y',...args,path]);
const packets=run(['-i',path,'-map','0:a:0','-c:a','copy','-f','framecrc','-']).toString();
const tb=/^#tb 0:\s*(\d+)\/(\d+)$/m.exec(packets);
const rows=packets.split('\n').filter(line=>/^0,/.test(line));
const ticks=rows.reduce((n,line)=>n+Number(line.split(',')[3]),0);
run(['-i',path,'-f','null','-']);
const data=readFileSync(path);
writeFileSync('tests/fixtures/music-mp3/mobile-long.json',JSON.stringify({file,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex'),packetDurationMs:Math.ceil(ticks*Number(tb[1])*1000/Number(tb[2])),sourceSeconds:180,source:'Locally synthesized sine wave; no song, voice, or third-party recording.',generator:run(['-version']).toString().split('\n')[0],encodingArguments:args},null,2)+'\n');
