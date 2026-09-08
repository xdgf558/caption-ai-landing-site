// Local matte extraction explicitly approved by the user. Originals are read
// only; each output is a new asset, not a replacement for any production cat.
import sharp from 'sharp';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const inputDir=process.argv[2];
if(!inputDir)throw new Error('Pass the directory containing the five original generated PNGs.');
const sources={head:'636290c3-2876-4e0b-b59b-db9931c61712',torso:'e181eb5d-ccd2-41c0-a893-0772b51bf4c0','front-leg':'04716e2f-05b5-4466-81e4-24289c991902','back-leg':'3c29f2fb-872a-460d-a6ee-706d3fa9c69d',tail:'53da863b-7717-4c48-8f12-c1f76af28998'};
const out=path.join(root,'public/assets');await mkdir(out,{recursive:true});
const manifest={};
for(const [name,id] of Object.entries(sources)) {
  const bytes=await readFile(path.join(inputDir,'exec-'+id+'.png'));
  const {data,info}=await sharp(bytes).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const {width:w,height:h}=info,n=w*h,removed=new Uint8Array(n),queue=new Uint32Array(n);
  const neutral=i=>{const j=i*4,r=data[j],g=data[j+1],b=data[j+2];return Math.min(r,g,b)>183&&Math.max(r,g,b)-Math.min(r,g,b)<24;};
  let count=0,cursor=0;
  function add(i){if(i>=0&&i<n&&!removed[i]&&neutral(i)){removed[i]=1;queue[count++]=i;}}
  for(let x=0;x<w;x++){add(x);add((h-1)*w+x);}for(let y=0;y<h;y++){add(y*w);add(y*w+w-1);}
  while(cursor<count){const i=queue[cursor++],x=i%w;if(x)add(i-1);if(x<w-1)add(i+1);add(i-w);add(i+w);}
  let left=w,top=h,right=0,bottom=0;
  for(let i=0;i<n;i++) {
    if(removed[i]){data[i*4+3]=0;continue;}
    const x=i%w,y=Math.floor(i/w);
    left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
  }
  if(count/n<.2||right<=left||bottom<=top)throw new Error('Unexpected source matte: '+name);
  left=Math.max(0,left-4);top=Math.max(0,top-4);right=Math.min(w-1,right+4);bottom=Math.min(h-1,bottom+4);
  const encoded=await sharp(data,{raw:{width:w,height:h,channels:4}}).extract({left,top,width:right-left+1,height:bottom-top+1}).resize({width:name==='torso'?850:name==='tail'?650:520,height:name==='torso'?850:name==='tail'?650:620,fit:'inside',withoutEnlargement:true}).webp({quality:92,alphaQuality:100,effort:6}).toBuffer();
  await writeFile(path.join(out,name+'.webp'),encoded);
  const {data:rgba,info:m}=await sharp(encoded).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const profile=[];
  for(let j=0;j<=64;j++) {
    const along=Math.round(j/64*((name==='tail'?m.width:m.height)-1));let weighted=0,weight=0;
    for(let across=0;across<(name==='tail'?m.height:m.width);across++) {
      const x=name==='tail'?along:across,y=name==='tail'?across:along,a=rgba[(y*m.width+x)*4+3];
      if(a>32){weight+=a;weighted+=across*a;}
    }
    profile.push(weight?weighted/weight/(name==='tail'?m.height:m.width):.5);
  }
  // Transparent endpoint padding must not send strip centers abruptly sideways.
  for(let j=1;j<profile.length-1;j++)if(profile[j]===.5)profile[j]=(profile[j-1]+profile[j+1])/2;
  manifest[name]={width:m.width,height:m.height,bytes:encoded.length,profile,source:'exec-'+id+'.png',sourceSHA256:createHash('sha256').update(bytes).digest('hex'),transparentRatio:Number((count/n).toFixed(3))};
  console.log(name,`${m.width}x${m.height}`,encoded.length,'bytes, real alpha');
}
await writeFile(path.join(out,'rig-meta.json'),JSON.stringify(manifest,null,2)+'\n');
