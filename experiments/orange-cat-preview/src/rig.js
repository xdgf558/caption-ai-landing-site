import { Container, MeshSimple, Graphics, Sprite } from 'pixi.js';
import { chainPoint, FLOOR_Y, MOUTH_LOCAL, MOUTH_OPEN_SCALE, FOOD_SURFACE, headLandmark, headSkinPoint, mix, smooth } from './motion.js';
import { profileAt, legSkinPoint } from './skin.js';

function meshGrid(texture, cols, rows) {
  const vertices = new Float32Array((cols+1)*(rows+1)*2), uvs = vertices.slice(), indices = [];
  for(let y=0;y<=rows;y++) for(let x=0;x<=cols;x++) {
    const i=(y*(cols+1)+x)*2; uvs[i]=x/cols; uvs[i+1]=y/rows;
  }
  for(let y=0;y<rows;y++) for(let x=0;x<cols;x++) {
    const a=y*(cols+1)+x,b=a+1,c=a+cols+1,d=c+1; indices.push(a,b,c,b,d,c);
  }
  const mesh = new MeshSimple({ texture, vertices, uvs, indices:new Uint32Array(indices) });
  return { mesh, vertices, uvs, cols, rows };
}

function bendStrip(grid, points, width, horizontal, profile) {
  const {vertices,uvs}=grid;
  for(let i=0;i<vertices.length;i+=2) {
    const along=horizontal?uvs[i]:uvs[i+1],across=horizontal?uvs[i+1]:uvs[i];
    const t=along;
    const p=chainPoint(points,t),before=chainPoint(points,Math.max(0,t-.005)),after=chainPoint(points,Math.min(1,t+.005));
    const dx=after.x-before.x,dy=after.y-before.y,len=Math.hypot(dx,dy)||1;
    const offset=(across-profileAt(profile,along))*width;
    // Vertical textures have +U pointing right; horizontal ones +V down.
    const sign=horizontal?1:-1;
    vertices[i]=p.x-sign*dy/len*offset;vertices[i+1]=p.y+sign*dx/len*offset;
  }
}

export class OrangeCatRig {
  constructor(textures,meta,feedingMeta) {
    this.root=new Container(); this.root.eventMode='none'; this.meta=meta;
    this.far=new Container();this.near=new Container();this.tail=meshGrid(textures.tail,40,6);
    this.body=meshGrid(textures.torso,24,12);this.head=meshGrid(textures.head,18,18);this.headRoot=new Container();
    this.mouth=new Sprite(textures['mouth-open']);
    this.mouth.pivot.set(feedingMeta.mouth.upperLip.x-feedingMeta.mouth.crop.left,feedingMeta.mouth.upperLip.y-feedingMeta.mouth.crop.top);
    this.mouth.position.set(MOUTH_LOCAL.x,MOUTH_LOCAL.y);
    this.headRoot.addChild(this.head.mesh,this.mouth);
    this.food=new Container();
    this.pellets=Array.from({length:3},()=>{const sprite=new Sprite(textures.kibble);sprite.anchor.set(.5);this.food.addChild(sprite);return sprite;});
    this.legs=new Map();this.debug=new Graphics();
    this.root.addChild(this.tail.mesh,this.far,this.body.mesh,this.near,this.headRoot,this.food,this.debug);
    for(const name of ['far-back','far-front','near-back','near-front']) {
      const back=name.includes('back'),far=name.includes('far'),grid=meshGrid(textures[back?'back-leg':'front-leg'],10,32);
      if(far)grid.mesh.tint=0xd5b78f;
      (far?this.far:this.near).addChild(grid.mesh);this.legs.set(name,grid);
    }
  }
  draw(pose,bones=false) {
    this.root.position.set(pose.rootX,FLOOR_Y);
    for(const leg of pose.legs) {
      const key=leg.kind==='back'?'back-leg':'front-leg';
      const grid=this.legs.get(leg.name);
      for(let i=0;i<grid.vertices.length;i+=2) {
        const point=legSkinPoint(grid.uvs[i],grid.uvs[i+1],leg,this.meta[key]);
        grid.vertices[i]=point.x;grid.vertices[i+1]=point.y;
      }
    }
    bendStrip(this.tail,pose.tail,31,true,this.meta.tail?.profile);
    const body=this.body;
    for(let i=0;i<body.vertices.length;i+=2) {
      const u=body.uvs[i],v=body.uvs[i+1];
      body.vertices[i]=-141+u*290;
      const chest=Math.pow(1-u,2)*pose.lower*23;
      body.vertices[i+1]=-204+v*139+pose.bob+chest+Math.sin(v*Math.PI)*pose.breath*1.5;
    }
    const head=this.head;
    for(let i=0;i<head.vertices.length;i+=2) {
      const u=head.uvs[i],v=head.uvs[i+1];
      const point=headSkinPoint(u,v,pose.time);
      head.vertices[i]=point.x;head.vertices[i+1]=point.y;
    }
    this.headRoot.position.set(pose.head.x,pose.head.y);this.headRoot.rotation=pose.head.rotation;
    const jaw=pose.bite.jaw;
    this.mouth.visible=jaw>.015;
    this.mouth.alpha=smooth(jaw/.22);
    this.mouth.scale.set(MOUTH_OPEN_SCALE.x,MOUTH_OPEN_SCALE.y*jaw);
    // Food follows a short path from the bowl into the actual open cavity.
    // It is never drawn travelling while the lips are closed.
    this.food.visible=pose.bowl;
    const inside=headLandmark(pose.head,{x:MOUTH_LOCAL.x+23*MOUTH_OPEN_SCALE.x,y:MOUTH_LOCAL.y+29*MOUTH_OPEN_SCALE.y*jaw},pose.rootX);
    for(let i=0;i<this.pellets.length;i++) {
      const pellet=this.pellets[i],active=pose.bite.index===i&&pose.bite.foodVisible;
      const taken=pose.bite.consumed>i;
      pellet.visible=!taken;
      const start={x:FOOD_SURFACE.x-20+i*8,y:FOOD_SURFACE.y+2-i*1.3};
      const progress=active?pose.bite.foodProgress:0;
      const shrink=active?1-.62*smooth((progress-.65)/.35):1;
      pellet.width=12*shrink;pellet.height=12*shrink*pellet.texture.height/pellet.texture.width;
      pellet.alpha=active?1-smooth((progress-.9)/.1):1;
      pellet.position.set(mix(start.x,inside.x,progress)-pose.rootX,mix(start.y,inside.y,progress)-FLOOR_Y-Math.sin(progress*Math.PI)*2);
      pellet.rotation=active?progress*.8:i*.4;
    }
    this.debug.clear();this.debug.visible=bones;
    if(bones) {
      for(const leg of pose.legs) {
        const color=leg.far?0x4884a4:0xf58c3b;
        this.debug.moveTo(leg.points[0].x,leg.points[0].y);
        leg.points.slice(1).forEach(p=>this.debug.lineTo(p.x,p.y));this.debug.stroke({color,width:2.5,alpha:.85});
        leg.points.forEach(p=>this.debug.circle(p.x,p.y,3.3).fill({color}));
        const foot=leg.points.at(-1);this.debug.ellipse(foot.x,foot.y+3,12,3).fill({color:leg.planted?0x48815b:0xd7644a,alpha:.75});
      }
      this.debug.moveTo(pose.tail[0].x,pose.tail[0].y);pose.tail.slice(1).forEach(p=>this.debug.lineTo(p.x,p.y));this.debug.stroke({color:0x68a16c,width:2});
      const shoulder=pose.legs.find(leg=>leg.name==='near-front').points[0];
      this.debug.moveTo(shoulder.x,shoulder.y).lineTo(pose.neck.x,pose.neck.y).stroke({color:0x68a16c,width:2});
      this.debug.circle(pose.neck.x,pose.neck.y,5).fill({color:0xf58c3b});
    }
  }
  destroy() { this.root.destroy({children:true}); }
}
