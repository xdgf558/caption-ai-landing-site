import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleMotion,solveIK,gaitFoot,duration,chainPoint } from '../src/motion.js';
test('all three clips produce finite poses at boundaries and dense subframes',()=>{
  for(const action of Object.keys(duration))for(let time=-.1;time<duration[action]+.2;time+=.013){const p=sampleMotion(action,time);assert(Number.isFinite(p.rootX));for(const leg of p.legs)for(const point of leg.points)assert(Number.isFinite(point.x)&&Number.isFinite(point.y));assert(p.time>=0&&p.time<=duration[action]);}
});
test('planted feet cancel root travel without skating, independent of speed',()=>{
  for(const offset of [0,.25,.5,.75])for(let d=0;d<250;d+=.31){const a=gaitFoot(d,offset),b=gaitFoot(d+.01,offset);if(a.planted&&b.planted&&b.phase>a.phase)assert(Math.abs((a.x-d)-(b.x-d-.01))<1e-8);}
});
test('swing clears floor and stance does not sink',()=>{
  let lifted=false;for(let d=0;d<90;d+=.1){const f=gaitFoot(d);assert(f.y<=0);if(f.planted)assert.equal(f.y,0);else if(f.y < -20)lifted=true;}assert(lifted);
});
test('two bone lengths remain fixed for reachable targets',()=>{
  const root={x:0,y:0},target={x:25,y:118},knee=solveIK(root,target,70,72,-1);assert(Math.abs(Math.hypot(knee.x,knee.y)-70)<1e-8);assert(Math.abs(Math.hypot(target.x-knee.x,target.y-knee.y)-72)<1e-8);
});
test('IK handles coincident and unreachable targets without NaN',()=>{
  for(const target of [{x:0,y:0},{x:999,y:-999},{x:0,y:1}]){const k=solveIK({x:0,y:0},target);assert(Number.isFinite(k.x)&&Number.isFinite(k.y));}
});
test('eating moves head independently with planted feet and fixed root',()=>{
  const a=sampleMotion('eat',4),b=sampleMotion('eat',7);assert.equal(a.rootX,b.rootX);assert(a.head.rotation < -.5);for(let i=0;i<4;i++)assert.deepEqual(a.legs[i].worldFoot,b.legs[i].worldFoot);assert(Math.abs(a.head.y-b.head.y)>0);
});
test('walking ends grounded; clips are deterministic and time clamps',()=>{
  const p=sampleMotion('walk',6);assert(p.ended);assert(p.legs.every(l=>l.planted&&l.worldFoot.y<=0));assert.deepEqual(sampleMotion('walk',2.4),sampleMotion('walk',2.4));assert.equal(sampleMotion('eat',999).time,10);assert.equal(sampleMotion('idle',NaN).time,0);
});
test('chain interpolation retains end points',()=>{const p=[{x:0,y:0},{x:20,y:30},{x:40,y:10}];assert.deepEqual(chainPoint(p,0),p[0]);assert.deepEqual(chainPoint(p,1),p[2]);});
