/* =========================================================
   ギターの3Dモデル（実寸）
   ・アコースティック：ドレッドノート。スプルースの表板・サウンドホール・ロゼッタ・ピックガード・
                       ブリッジとブリッジピン・3対3のヘッド（少し後ろへ傾いている）
   ・エレキ　　　　　：ストラトタイプ。ダブルカッタウェイのボディ・ピックガード・
                       シングルコイル3つ・トレモロブリッジ・ノブ3つ・6連ペグのヘッド
   作る前に geom.js の setGuitarType() で寸法を切り替えておく
   ========================================================= */
import * as THREE from 'three';
import { GTYPE, NSTR, fretX, slotCenter, halfW, strY, STRING_R, stringZ, FRET_TOP, NECK_DEPTH, FB_T,
         BODY_X0, BODY_LEN, BODY_DEPTH, BODY_TOP, FB_END, HEAD_LEN, NUM_FRETS, SCALE_LEN, G, DEG } from './geom.js';

/* ---------- 木目テクスチャ（その場で描く） ---------- */
function rng(seed){ return ()=>{ seed=(seed*16807)%2147483647; return (seed-1)/2147483646; }; }
function drawGrain(g, w, h, {base, dark, light, lines=140, wave=6, seed=1, figure=0}){
  const r = rng(seed);
  g.fillStyle = base; g.fillRect(0,0,w,h);
  for(let i=0;i<lines;i++){
    const y0 = r()*h, amp = 1+r()*wave, ph = r()*6.28, f = 0.5+r()*2;
    g.strokeStyle = r()<0.55 ? dark : light;
    g.globalAlpha = 0.05 + r()*0.22;
    g.lineWidth = 0.6 + r()*2.6;
    g.beginPath();
    for(let x=0;x<=w;x+=8){ const y = y0 + Math.sin(x/w*6.28*f+ph)*amp + Math.sin(x/w*40+ph*3)*amp*0.15; x?g.lineTo(x,y):g.moveTo(x,y); }
    g.stroke();
  }
  if(figure){ // 杢（光の帯）
    for(let i=0;i<figure;i++){ const x=r()*w; const gr=g.createLinearGradient(x-20,0,x+20,0);
      gr.addColorStop(0,'rgba(255,255,255,0)'); gr.addColorStop(.5,'rgba(255,230,200,.07)'); gr.addColorStop(1,'rgba(255,255,255,0)');
      g.globalAlpha=1; g.fillStyle=gr; g.fillRect(x-20,0,40,h); }
  }
  g.globalAlpha = 1;
}
function canvasTex(c, repeat=true){
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; if(repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}
function woodTexture(o){
  const w = o.w || 1024, h = o.h || 256;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  drawGrain(c.getContext('2d'), w, h, o);
  return canvasTex(c);
}
/* 表板の絵：木目（またはぬりつぶし）＋サンバースト（ふちが濃く、まん中が明るいぼかし）。
   ボディをちょうど囲む四角に1枚で貼る */
function topTexture(f, box){
  const w = 1024, h = 640;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  if(f.top) drawGrain(g, w, h, {...f.top, lines:(f.top.lines||140)*2});
  else { g.fillStyle = f.paint; g.fillRect(0,0,w,h); }
  if(f.burst){
    // ボディの形に合わせたぼかし（中心は下のふくらみ寄り）
    const [cx, rx, ry] = f.burstAt || [0.62, 0.62, 0.56];
    g.save(); g.translate(cx*w, h/2); g.scale(rx*w, ry*h);
    const gr = g.createRadialGradient(0,0,0, 0,0,1);
    f.burst.forEach(([t, col])=>gr.addColorStop(t, col));
    g.fillStyle = gr; g.fillRect(-2,-2,4,4); g.restore();
  }
  return canvasTex(c, false);
}
// 形の頂点の位置から、四角(box)の中の位置をそのまま絵の座標にする
function boxUV(geo, [x0,x1,y0,y1]){
  const p = geo.attributes.position, uv = geo.attributes.uv;
  for(let i=0;i<uv.count;i++) uv.setXY(i, (p.getX(i)-x0)/(x1-x0), (p.getY(i)-y0)/(y1-y0));
  uv.needsUpdate = true; return geo;
}
const uvScale = (geo, sx, sy) => { const uv = geo.attributes.uv; for(let i=0;i<uv.count;i++) uv.setXY(i, uv.getX(i)*sx, uv.getY(i)*sy); return geo; };

/* ---------- ボディの輪郭 ---------- */
// アコースティック（ドレッドノート）：上半分の (ボディの頭からの距離, 半幅) → 上下対称
const ACOUSTIC_HALF = [[0,0],[2,40],[8,80],[22,115],[45,137],[80,146],[115,143],[160,138],[200,136.5],[240,145],
                       [290,175],[340,194],[380,198.5],[420,192],[460,165],[490,115],[503,60],[508,0]];
// エレキ（ストラトタイプ）：左右非対称なので1周ぶん。x はネックのはめこみ口からの距離、y は -：6弦側（上のツノが長い）
const ELECTRIC_LOOP = [[0,-28],[-2,-48],[-8,-66],[-20,-82],[-38,-95],[-58,-104],[-73,-110],[-81,-118],[-79,-128],[-66,-136],[-35,-144],[10,-150],[60,-152],[108,-146],[155,-137],[200,-141],[245,-155],[288,-162],[318,-150],[335,-110],[343,-55],[343,0],[343,55],[335,112],[318,152],[288,163],[245,160],[200,147],[160,138],[118,140],[70,142],[25,136],[-10,128],[-30,121],[-40,112],[-38,103],[-26,94],[-12,82],[-3,64],[2,46],[0,28]];
export function bodyOutline(){
  let pts;
  if(GTYPE === 'electric') pts = ELECTRIC_LOOP.map(([x,y])=>new THREE.Vector3(BODY_X0+x, y, 0));
  else {
    const half = ACOUSTIC_HALF.map(([x,y])=>[BODY_X0+x, y]);
    pts = half.map(([x,y])=>new THREE.Vector3(x,y,0));
    for(let i=half.length-2;i>0;i--) pts.push(new THREE.Vector3(half[i][0], -half[i][1], 0));
  }
  const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
  const out = curve.getSpacedPoints(300).slice(0,-1).map(v=>new THREE.Vector2(v.x, v.y));
  if(signedArea(out) < 0) out.reverse();
  return out;
}
function insetPath(p, d){
  const n = p.length, out = [];
  for(let i=0;i<n;i++){
    const a = p[(i-1+n)%n], b = p[(i+1)%n];
    const tx = b.x-a.x, ty = b.y-a.y, l = Math.hypot(tx,ty)||1;
    // 反時計回りの輪郭なら、内側は (-ty, tx) の向き（d がマイナスなら外側）
    out.push(new THREE.Vector2(p[i].x - ty/l*d, p[i].y + tx/l*d));
  }
  return out;
}
function signedArea(p){ let s=0; for(let i=0;i<p.length;i++){ const a=p[i], b=p[(i+1)%p.length]; s+=a.x*b.y-b.x*a.y; } return s/2; }
const ccw = pts => signedArea(pts) < 0 ? pts.slice().reverse() : pts;
const smoothLoop = (xy, n=160) => ccw(new THREE.CatmullRomCurve3(xy.map(([x,y])=>new THREE.Vector3(x,y,0)), true, 'centripetal')
  .getSpacedPoints(n).slice(0,-1).map(v=>new THREE.Vector2(v.x, v.y)));
const shapeOf = (pts, holes=[]) => { const s = new THREE.Shape(pts); holes.forEach(h=>s.holes.push(new THREE.Path(h))); return s; };
function roundRect(w, h, r){   // 中心が原点の角丸の四角
  const s = new THREE.Shape(), x = -w/2, y = -h/2;
  s.moveTo(x+r, y); s.lineTo(x+w-r, y); s.quadraticCurveTo(x+w, y, x+w, y+r); s.lineTo(x+w, y+h-r); s.quadraticCurveTo(x+w, y+h, x+w-r, y+h);
  s.lineTo(x+r, y+h); s.quadraticCurveTo(x, y+h, x, y+h-r); s.lineTo(x, y+r); s.quadraticCurveTo(x, y, x+r, y);
  return s;
}

/* ---------- 弦（細い円柱をつないで作る） ---------- */
const UNIT_CYL = new THREE.CylinderGeometry(1,1,1,8,1,false);
function placeSeg(mesh, a, b, r){
  const A = new THREE.Vector3(...a), Bv = new THREE.Vector3(...b);
  const d = Bv.clone().sub(A), len = d.length();
  mesh.position.copy(A).addScaledVector(d, 0.5);
  mesh.scale.set(r, len, r);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), d.normalize());
  mesh.visible = true;
}

/* ギターの柄（設定ボタンから選ぶ）。種類ごとに別のリスト */
const SPRUCE = {base:'#e2c48e', dark:'#b8915a', light:'#f6e2b8', lines:120, wave:1.2, seed:7, figure:3};
const ROSEWOOD_BS = {base:'#3a1d12', dark:'#1a0a05', light:'#5a3020', lines:170, wave:4, seed:13, figure:8};
const MAHOGANY = {base:'#6b3518', dark:'#3a1a0a', light:'#8a4a24', lines:160, wave:5, seed:3, figure:10};
const ALDER = {base:'#d9a860', dark:'#a87536', light:'#ecc489', lines:90, wave:6, seed:31, figure:4};
const BURST3 = [[0,'rgba(0,0,0,0)'],[0.5,'rgba(0,0,0,0)'],[0.7,'rgba(150,30,10,.75)'],[0.86,'rgba(40,10,4,.96)'],[1,'rgba(14,5,2,1)']];
export const FINISHES = {
  acoustic: {
    natural:  {label:'ナチュラル', top:SPRUCE, side:ROSEWOOD_BS, rough:0.3, guard:'tort'},
    sunburst: {label:'サンバースト', top:SPRUCE, side:MAHOGANY, rough:0.26, guard:'black',
               burst:[[0,'rgba(0,0,0,0)'],[0.42,'rgba(0,0,0,0)'],[0.62,'rgba(190,100,20,.55)'],[0.84,'rgba(70,25,6,.92)'],[1,'rgba(25,8,2,1)']]},
    mahogany: {label:'マホガニー', top:MAHOGANY, side:MAHOGANY, rough:0.36, guard:'tort'},
    black:    {label:'ブラック', paint:'#151314', side:{paint:'#151314'}, rough:0.14, guard:'black'},
  },
  electric: {
    sunburst: {label:'3トーン', top:ALDER, burst:BURST3, burstAt:[0.55,0.58,0.6], rough:0.14, guard:'white', fb:'rosewood'},
    tort:     {label:'サンバースト＋べっこう', top:ALDER, burst:BURST3, burstAt:[0.55,0.58,0.6], rough:0.14, guard:'tort', fb:'maple'},
    white:    {label:'ホワイト', paint:'#ece6d4', rough:0.16, guard:'mint', fb:'maple'},
    red:      {label:'レッド', paint:'#a3121b', metal:0.35, rough:0.18, guard:'white', fb:'rosewood'},
    blue:     {label:'ソニックブルー', paint:'#86b6c6', rough:0.18, guard:'white', fb:'rosewood'},
    black:    {label:'ブラック', paint:'#121112', rough:0.12, guard:'white', fb:'maple'},
  },
};
const GUARD_COL = {tort:null, black:'#0d0b0b', white:'#f1eee6', mint:'#e9ead5'};
function tortTexture(){
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'), r = rng(77);
  g.fillStyle = '#2a0f05'; g.fillRect(0,0,256,256);
  for(let i=0;i<420;i++){ const x=r()*256, y=r()*256, rr=3+r()*10;
    const gr = g.createRadialGradient(x,y,0,x,y,rr); const col = r()<0.45 ? '110,45,12' : r()<0.5 ? '150,70,20' : '12,4,1';
    gr.addColorStop(0,`rgba(${col},.45)`); gr.addColorStop(1,`rgba(${col},0)`); g.fillStyle = gr; g.fillRect(x-rr,y-rr,rr*2,rr*2); }
  const t = canvasTex(c); t.repeat.set(1/120, 1/120); return t;
}

export function buildGuitar(){
  const type = GTYPE, electric = type === 'electric';
  const g = new THREE.Group();
  const texCache = new Map();
  const wood = o => { const k = JSON.stringify(o); if(!texCache.has(k)) texCache.set(k, woodTexture(o)); return texCache.get(k); };
  const std = o => new THREE.MeshStandardMaterial(o);
  const rosewood = std({map: woodTexture({base:'#2a1810', dark:'#120905', light:'#3d2416', lines:200, wave:2, seed:5, w:2048, h:128}), roughness:0.6});
  const maple = std({map: woodTexture({base:'#e7c286', dark:'#c49556', light:'#f4dcae', lines:120, wave:3, seed:41, w:2048, h:128}), roughness:0.32});
  const neckMat = electric ? std({map: wood({base:'#e2b878', dark:'#bb8a4c', light:'#f2d6a4', lines:120, wave:3, seed:43}), roughness:0.3})
                           : std({map: wood(MAHOGANY), roughness:0.4});
  const headWood = electric ? neckMat : std({map: woodTexture({base:'#24130b', dark:'#110803', light:'#3a1e0f', lines:120, wave:3, seed:11}), roughness:0.35});
  const binding = std({color:'#ece3cc', roughness:0.32});
  const bone = std({color:'#efe6cf', roughness:0.38});
  const fretMetal = std({color:'#ddd9d0', metalness:1, roughness:0.2});
  const chrome = std({color:'#ececef', metalness:1, roughness:0.12});
  const pearl = std({color:'#efeae0', roughness:0.25});
  const blackDot = std({color:'#17110d', roughness:0.4});
  const dark = new THREE.MeshBasicMaterial({color:'#0b0603'});
  const add = (geo, mat, f, parent=g) => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; f && f(m); parent.add(m); return m; };

  /* ---------- ボディ ---------- */
  const outline = bodyOutline();
  let minY = 0, maxY = 0, minX = 1e9, maxX = -1e9;
  outline.forEach(v=>{ minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y); minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x); });
  const box = [minX, maxX, minY, maxY];
  const topMat = std({roughness:0.3}), backMat = std({roughness:0.35}), sideMat = std({roughness:0.38});
  const guardMat = std({roughness:0.22});
  let pickupMat = null, knobMat = null;
  const SH_X = FB_END + 53, SH_R = 50;                       // サウンドホール（直径100mm）
  if(!electric){
    const plate = 3;
    const holePts = []; for(let i=0;i<72;i++){ const a=-i/72*Math.PI*2; holePts.push(new THREE.Vector2(SH_X+Math.cos(a)*SH_R, Math.sin(a)*SH_R)); }
    const topGeo = boxUV(new THREE.ExtrudeGeometry(shapeOf(outline,[holePts]), {depth:plate, bevelEnabled:true, bevelThickness:0.6, bevelSize:0.6, bevelSegments:2, curveSegments:24}), box);
    add(topGeo, topMat, m=>{ m.position.z = BODY_TOP - plate - 0.6; });
    const backGeo = uvScale(new THREE.ExtrudeGeometry(shapeOf(outline), {depth:plate, bevelEnabled:true, bevelThickness:0.6, bevelSize:0.6, bevelSegments:2}), 1/400, 1/80);
    add(backGeo, backMat, m=>{ m.position.z = BODY_TOP - BODY_DEPTH + 0.6; });
    const inner = insetPath(outline, 2.5);
    const sideGeo = uvScale(new THREE.ExtrudeGeometry(shapeOf(outline,[inner.slice().reverse()]), {depth:BODY_DEPTH-2*plate, bevelEnabled:false, curveSegments:24}), 1/400, 1/80);
    add(sideGeo, sideMat, m=>{ m.position.z = BODY_TOP - BODY_DEPTH + plate; });
    // バインディング（縁の白いライン）
    const bindIn = insetPath(outline, 2.2);
    const bindGeo = new THREE.ExtrudeGeometry(shapeOf(insetPath(outline,-0.6),[bindIn.slice().reverse()]), {depth:2.6, bevelEnabled:false});
    add(bindGeo, binding, m=>{ m.position.z = BODY_TOP - 3.0; });
    add(bindGeo, binding, m=>{ m.position.z = BODY_TOP - BODY_DEPTH + 0.4; });
    // サウンドホールの奥（暗い）とロゼッタ（飾りの輪）
    add(new THREE.CircleGeometry(SH_R+1, 64), dark, m=>{ m.position.set(SH_X, 0, BODY_TOP-60); m.castShadow = false; });
    [[SH_R+4, SH_R+5.2, '#1a0e07'], [SH_R+5.2, SH_R+8.4, '#e2d3b0'], [SH_R+8.4, SH_R+9.2, '#1a0e07'], [SH_R+9.2, SH_R+9.8, '#b58a5a'],
     [SH_R+11.5, SH_R+12.3, '#1a0e07'], [SH_R+12.3, SH_R+13.1, '#e2d3b0']].forEach(([a,b,c])=>{
      add(new THREE.RingGeometry(a, b, 96), std({color:c, roughness:0.4}), m=>{ m.position.set(SH_X, 0, BODY_TOP+0.04); m.castShadow=false; });
    });
    // ピックガード（サウンドホールの下・1弦側の涙の形）
    const rr = SH_R + 14.5, arc = [];
    for(let a=150; a>=12; a-=6){ const t = a*DEG; arc.push([SH_X+Math.cos(t)*rr, Math.sin(t)*rr]); }
    const guardPts = [...arc, [SH_X+66,52],[SH_X+70,84],[SH_X+52,113],[SH_X+12,126],[SH_X-30,118],[SH_X-58,96]];
    const gp = ccw(guardPts.map(([x,y])=>new THREE.Vector2(x,y)));
    add(new THREE.ExtrudeGeometry(shapeOf(gp), {depth:0.6, bevelEnabled:true, bevelThickness:0.2, bevelSize:0.4, bevelSegments:1, curveSegments:12}), guardMat,
        m=>{ m.position.z = BODY_TOP + 0.05; m.castShadow = false; });
    /* ブリッジ（ローズウッド）・サドル（骨）・ブリッジピン */
    const bl = 152, bw = 30, bh = 9;
    const br = new THREE.Shape();
    br.moveTo(-bw/2, -bl/2+10); br.quadraticCurveTo(-bw/2, -bl/2, -bw/2+10, -bl/2); br.lineTo(bw/2-6, -bl/2); br.quadraticCurveTo(bw/2, -bl/2, bw/2, -bl/2+6);
    br.lineTo(bw/2, bl/2-6); br.quadraticCurveTo(bw/2, bl/2, bw/2-6, bl/2); br.lineTo(-bw/2+10, bl/2); br.quadraticCurveTo(-bw/2, bl/2, -bw/2, bl/2-10);
    br.quadraticCurveTo(-bw/2-3, 0, -bw/2, -bl/2+10);
    const bx = SCALE_LEN + 7;
    add(new THREE.ExtrudeGeometry(br, {depth:bh-2, bevelEnabled:true, bevelThickness:1, bevelSize:1.2, bevelSegments:3}), rosewood, m=>{ m.position.set(bx, 0, BODY_TOP+1); });
    const sad = add(new THREE.BoxGeometry(3, 74, 6), bone, m=>{ m.position.set(SCALE_LEN+1.8, 0, stringZ(SCALE_LEN)-3); m.rotation.z = 2*DEG; });
    sad.castShadow = false;
    for(let s=0;s<NSTR;s++){
      const p = [SCALE_LEN+16, strY(s, SCALE_LEN), BODY_TOP+bh];
      add(new THREE.SphereGeometry(1,16,10), pearl, m=>{ m.scale.set(3.2,3.2,2.2); m.position.set(...p); });
      add(new THREE.CircleGeometry(1.1, 12), blackDot, m=>{ m.position.set(p[0], p[1], p[2]+2.25); m.castShadow = false; });
    }
    // エンドピン（ストラップをかける所）
    add(new THREE.CylinderGeometry(3.5,4.5,9,16), pearl, m=>{ m.rotation.z = Math.PI/2; m.position.set(maxX+3, 0, BODY_TOP-BODY_DEPTH/2); });
  } else {
    // ボディは1枚板。ふちを丸く削ってある
    const r = 6;
    const bodyGeo = boxUV(new THREE.ExtrudeGeometry(shapeOf(outline), {depth:BODY_DEPTH-2*r, bevelEnabled:true, bevelThickness:r, bevelSize:r, bevelOffset:-r, bevelSegments:5, curveSegments:24}), box);
    add(bodyGeo, topMat, m=>{ m.position.z = BODY_TOP - BODY_DEPTH + r; });
    // ピックガード（3層：表・白・黒の線が縁に見える）
    const X = BODY_X0;
    const guardXY = [[10,-30],[8,-48],[2,-64],[-10,-80],[-28,-94],[-42,-104],[-40,-116],[-14,-124],[40,-128],[100,-122],[160,-104],[205,-82],[226,-62],[228,-44],[228,42],[244,54],[272,66],[300,84],[312,108],[300,130],[262,140],[205,136],[150,128],[100,130],[40,128],[0,118],[-14,108],[-10,96],[2,84],[10,66],[13,46],[12,30]].map(([x,y])=>[X+x,y]);
    const gp = smoothLoop(guardXY, 220);
    add(new THREE.ExtrudeGeometry(shapeOf(gp), {depth:1.6, bevelEnabled:true, bevelThickness:0.4, bevelSize:0.8, bevelSegments:2, curveSegments:12}), guardMat,
        m=>{ m.position.z = BODY_TOP + 0.4; });
    add(new THREE.ExtrudeGeometry(shapeOf(insetPath(gp,-1.4)), {depth:1.2, bevelEnabled:false}), std({color:'#111', roughness:0.5}), m=>{ m.position.z = BODY_TOP + 0.05; m.castShadow = false; });
    const gTop = BODY_TOP + 2.4;
    // ピックアップ（シングルコイル×3）。ブリッジ側は少し斜め
    pickupMat = std({color:'#f2efe6', roughness:0.35});
    const pole = std({color:'#b8b8bc', metalness:1, roughness:0.3});
    [[SCALE_LEN-160, 0], [SCALE_LEN-102, 0], [SCALE_LEN-42, -10]].forEach(([px, rot])=>{
      const top = stringZ(px) - 3.4, h = top - gTop;
      const grp = new THREE.Group(); grp.position.set(px, 0, gTop); grp.rotation.z = rot*DEG; g.add(grp);
      add(new THREE.ExtrudeGeometry(roundRect(17.5, 72, 8.6), {depth:h-1.5, bevelEnabled:true, bevelThickness:1.5, bevelSize:1, bevelOffset:-1, bevelSegments:3}), pickupMat, null, grp);
      for(let s=0;s<NSTR;s++) add(new THREE.CylinderGeometry(2.4,2.4,1,12), pole, m=>{ m.rotation.x = Math.PI/2; m.position.set(0, strY(s, px)/Math.cos(rot*DEG), h+0.1); }, grp);
    });
    // トレモロブリッジ：台座の板と6つのサドル（1本ずつ分かれていて、すき間がある。弦はサドルの溝を通って後ろの穴へ）
    const brushed = std({color:'#c9cacd', metalness:1, roughness:0.32});
    add(new THREE.BoxGeometry(58, 74, 2.2), brushed, m=>{ m.position.set(SCALE_LEN+13, 0, BODY_TOP+1.1); });
    add(new THREE.BoxGeometry(6, 74, 6), brushed, m=>{ m.position.set(SCALE_LEN+38, 0, BODY_TOP+5); });          // 弦を通す後ろの壁
    for(let s=0;s<NSTR;s++){
      const sx = SCALE_LEN + [3.2,2.6,2.2,1.4,1.0,0.4][s], y = strY(s, SCALE_LEN), top = stringZ(sx) - 0.3;
      const h = top - (BODY_TOP+2.2);
      // サドル：前が低く後ろが高い、曲げた板の形（横から見ると台形）
      const sh = new THREE.Shape(); sh.moveTo(-3, 0); sh.lineTo(14, 0); sh.lineTo(14, h*0.55); sh.lineTo(2, h); sh.lineTo(-1, h); sh.lineTo(-3, h*0.7); sh.closePath();
      add(new THREE.ExtrudeGeometry(sh, {depth:8.4, bevelEnabled:true, bevelThickness:0.5, bevelSize:0.5, bevelSegments:1}), brushed,
          m=>{ m.rotation.x = Math.PI/2; m.position.set(sx, y + 4.2, BODY_TOP+2.2); });
      add(new THREE.CylinderGeometry(1.1,1.1,h*0.9,8), blackDot, m=>{ m.rotation.x = Math.PI/2; m.position.set(sx+8, y-2.6, BODY_TOP+2.2+h*0.45); });   // 高さ調整のねじ
      add(new THREE.CylinderGeometry(1.1,1.1,h*0.9,8), blackDot, m=>{ m.rotation.x = Math.PI/2; m.position.set(sx+8, y+2.6, BODY_TOP+2.2+h*0.45); });
    }
    // アーム
    const arm = new THREE.CatmullRomCurve3([[SCALE_LEN+30,40,BODY_TOP+3],[SCALE_LEN+30,48,BODY_TOP+12],[SCALE_LEN+60,90,BODY_TOP+16],[SCALE_LEN+110,150,BODY_TOP+18]].map(p=>new THREE.Vector3(...p)));
    add(new THREE.TubeGeometry(arm, 24, 2.2, 8), chrome);
    add(new THREE.CylinderGeometry(3.5,3.5,14,12), pickupMat, m=>{ m.position.set(SCALE_LEN+113, 155, BODY_TOP+18); m.rotation.z = -32*DEG; });
    // ノブ3つ（ボリューム・トーン・トーン）と5段階のスイッチ
    knobMat = std({color:'#f2efe6', roughness:0.3});
    [[X+237,78],[X+265,98],[X+290,113]].forEach(([x,y])=>{
      add(new THREE.CylinderGeometry(9, 11, 15, 28), knobMat, m=>{ m.rotation.x = Math.PI/2; m.position.set(x, y, gTop+7.5); });
    });
    add(new THREE.BoxGeometry(20, 3.4, 0.4), dark, m=>{ m.position.set(X+205, 96, gTop+0.25); m.rotation.z = -35*DEG; m.castShadow = false; });
    add(new THREE.BoxGeometry(5, 7, 12), knobMat, m=>{ m.position.set(X+203, 95, gTop+6); m.rotation.z = -35*DEG; });
    // ストラップピン（おしりと上のツノの先）
    add(new THREE.CylinderGeometry(3.5,4.5,9,16), chrome, m=>{ m.rotation.z = Math.PI/2; m.position.set(maxX+3, 0, BODY_TOP-BODY_DEPTH/2); });
    add(new THREE.CylinderGeometry(3.5,4.5,9,16), chrome, m=>{ m.position.set(X-84, -120, BODY_TOP-BODY_DEPTH/2); });
  }

  /* ---------- ネック（指板の下の半楕円） ---------- */
  {
    const nx = 60, nt = 22, pos = [], idx = [], uv = [];
    const xa = -8, xb = electric ? FB_END + 2 : BODY_X0 + 4;
    for(let i=0;i<=nx;i++){
      const x = xa + (xb-xa)*i/nx;
      const hw = halfW(Math.max(0,x)) + 0.2, dpt = NECK_DEPTH(Math.max(0,x));
      for(let j=0;j<=nt;j++){
        const th = Math.PI*j/nt;
        pos.push(x, hw*Math.cos(th), -FB_T - dpt*Math.pow(Math.sin(th), 0.85));
        uv.push(x/200, j/nt*0.3);
      }
    }
    for(let i=0;i<nx;i++) for(let j=0;j<nt;j++){ const a=i*(nt+1)+j, b=a+nt+1; idx.push(a,a+1,b, b,a+1,b+1); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos,3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv,2));
    geo.setIndex(idx); geo.computeVertexNormals();
    add(geo, neckMat);
    if(electric){
      // ネックの端（ボディにはめこんだ所）のふた
      const s = new THREE.Shape(), hw = halfW(xb)+0.2, d = NECK_DEPTH(xb);
      s.moveTo(-hw, 0); for(let j=0;j<=nt;j++){ const th = Math.PI*j/nt; s.lineTo(-hw*Math.cos(th), -d*Math.pow(Math.sin(th),0.85)); }
      // 形の (横, 縦) → 実際の (y, z)、面の向きは +x
      const basis = new THREE.Matrix4().makeBasis(new THREE.Vector3(0,1,0), new THREE.Vector3(0,0,1), new THREE.Vector3(1,0,0));
      add(new THREE.ShapeGeometry(s), neckMat, m=>{ m.quaternion.setFromRotationMatrix(basis); m.position.set(xb, 0, -FB_T); });
    } else {
      // ヒール（ネックとボディのつなぎ目）
      const h = new THREE.Shape();
      const zN = -FB_T - NECK_DEPTH(BODY_X0-45), zB = BODY_TOP - BODY_DEPTH;
      h.moveTo(BODY_X0-45, zN); h.quadraticCurveTo(BODY_X0-10, zN-8, BODY_X0-8, zB+8);
      h.lineTo(BODY_X0+3, zB+3); h.lineTo(BODY_X0+3, -FB_T-1); h.lineTo(BODY_X0-45, -FB_T-1); h.closePath();
      add(new THREE.ExtrudeGeometry(h, {depth:34, bevelEnabled:true, bevelThickness:4, bevelSize:4, bevelSegments:4}), neckMat, m=>{ m.rotation.x = Math.PI/2; m.position.y = 17; });
    }
  }

  /* ---------- 指板（先細り）・フレット・ポジションマーク ---------- */
  const fbMat = std({roughness:0.5});
  const dotMat = std({roughness:0.3});
  {
    const geo = new THREE.BoxGeometry(1,1,1, 1,1,1);
    const p = geo.attributes.position;
    for(let i=0;i<p.count;i++){
      const X = (p.getX(i)+0.5)*FB_END;
      p.setXYZ(i, X, p.getY(i)*2*halfW(X), (p.getZ(i)-0.5)*FB_T);
    }
    geo.computeVertexNormals();
    add(geo, fbMat);
    for(let n=1;n<=NUM_FRETS;n++){
      const x = fretX(n);
      add(new THREE.CylinderGeometry(1.25,1.25, 2*halfW(x)-0.3, 10), fretMetal, m=>{ m.position.set(x,0,0); });
    }
    const dot = (x,y)=>add(new THREE.CircleGeometry(3.1, 24), dotMat, m=>{ m.position.set(x,y,0.03); m.castShadow=false; });
    const single = electric ? [3,5,7,9,15,17,19,21] : [3,5,7,9,15,17,19];
    single.forEach(n=>dot(slotCenter(n),0));
    dot(slotCenter(12),-11); dot(slotCenter(12),11);
    // 側面のポイント（6弦側＝上の縁）
    [...single, 12].forEach(n=>add(new THREE.CylinderGeometry(1,1,0.5,12), pearl, m=>{ m.rotation.x=Math.PI/2; m.position.set(slotCenter(n), -halfW(slotCenter(n))-0.15, -FB_T/2); }));
  }
  /* ナット */
  add(new THREE.BoxGeometry(5, 2*halfW(0)+0.6, FB_T+stringZ(0)), bone, m=>{ m.position.set(-2.5, 0, (stringZ(0)-FB_T)/2); });

  /* ---------- ヘッドとペグ ---------- */
  // ヘッドの中の座標 (x：ナットから先へマイナス, y, z：ヘッドの表が0) → 実際の座標
  const HEAD_TILT = electric ? 0 : -14*DEG, HX = -8;
  const head = new THREE.Group(); head.position.set(HX, 0, -FB_T); head.rotation.y = HEAD_TILT; g.add(head);
  const headW = (x,y,z) => { const v = new THREE.Vector3(x-HX, y, z).applyAxisAngle(new THREE.Vector3(0,1,0), HEAD_TILT); return [v.x+HX, v.y, v.z-FB_T]; };
  const posts = [];   // 各弦の巻き取り位置（ヘッドの中の座標）
  {
    const L = HEAD_LEN, T = 15;
    let s;
    if(!electric){
      // 3対3：ナットから少しずつ広がり、先は平ら
      s = new THREE.Shape();
      s.moveTo(4, -24.5); s.bezierCurveTo(-30,-29, -90,-37, -L+14,-38.5);
      s.quadraticCurveTo(-L+2,-38.5, -L,-30); s.lineTo(-L,30); s.quadraticCurveTo(-L+2,38.5, -L+14,38.5);
      s.bezierCurveTo(-90,37, -30,29, 4,24.5); s.closePath();
    } else {
      // 6連：ペグは6弦側（上）に一列。1弦側は先の方がくびれて、先は丸い
      s = shapeOf(smoothLoop([[4,-21.5],[-24,-27],[-60,-34],[-110,-37],[-150,-39],[-178,-41],[-193,-33],[-197,-16],[-191,-1],[-176,9],
                               [-152,14],[-124,9],[-98,4],[-74,6],[-48,14],[-22,20.5],[4,21.5]], 160));
    }
    add(new THREE.ExtrudeGeometry(s, {depth:T-2.4, bevelEnabled:true, bevelThickness:1.2, bevelSize:1.2, bevelSegments:3, curveSegments:20}), headWood,
        m=>{ m.position.set(-HX, 0, -T+1.2); }, head);
    // ペグ
    const button = electric ? std({color:'#e9e4d6', roughness:0.3}) : chrome;
    const tuner = (x, y, side) => {
      add(new THREE.CylinderGeometry(3,3,12,16), chrome, m=>{ m.rotation.x=Math.PI/2; m.position.set(x-HX,y,6); }, head);         // 巻き取りの軸
      add(new THREE.CylinderGeometry(5,5,1.4,20), chrome, m=>{ m.rotation.x=Math.PI/2; m.position.set(x-HX,y,0.7); }, head);
      add(new THREE.BoxGeometry(15,12,10), chrome, m=>{ m.position.set(x-HX+2, y+side*3, -T-5); }, head);                        // 裏のギア
      add(new THREE.CylinderGeometry(1.6,1.6,16,10), chrome, m=>{ m.position.set(x-HX+2, y+side*14, -T-5); }, head);
      add(new THREE.SphereGeometry(1,24,16), button, m=>{ m.scale.set(electric?8:10, 3.5, electric?7:8); m.position.set(x-HX+2, y+side*24, -T-5); }, head);
    };
    if(!electric){
      [[-128,-29],[-88,-27.5],[-48,-26],[-48,26],[-88,27.5],[-128,29]].forEach(([x,y],i)=>{ tuner(x, y, Math.sign(y)); posts.push([x, y - Math.sign(y)*3.2, 7]); });
    } else {
      for(let k=0;k<NSTR;k++){ const x = -40 - k*24, y = -25 - k*1.4; tuner(x, y, -1); posts.push([x, y + 3.2, 6]); }
      // ストリングガイド（2弦・1弦をヘッドに押さえつける）
      add(new THREE.CylinderGeometry(3,3,2.4,14), chrome, m=>{ m.rotation.x=Math.PI/2; m.position.set(-72-HX, -3, 4.5); }, head);
      add(new THREE.CylinderGeometry(1,1,4.5,8), chrome, m=>{ m.rotation.x=Math.PI/2; m.position.set(-72-HX, -3, 2); }, head);
    }
  }

  /* ---------- 弦（コードごとに形が変わる） ---------- */
  const wound = std({color: electric ? '#c9c4ba' : '#c9a061', metalness:1, roughness:0.38});
  const plain = std({color:'#dcdcde', metalness:1, roughness:0.22});
  const strings = Array.from({length:NSTR}, (_,s)=>{
    const segs = [];
    for(let k=0;k<8;k++){ const m = new THREE.Mesh(UNIT_CYL, s < G.wound ? wound : plain); m.castShadow = true; g.add(m); segs.push(m); }
    return segs;
  });
  const SADDLE_COMP = electric ? [3.2,2.6,2.2,1.4,1.0,0.4] : [3.4,2.8,2.2,3.0,2.0,1.0];
  function setStrings(strInfo){
    for(let s=0;s<NSTR;s++){
      const r = Math.max(0.2, STRING_R[s]), segs = strings[s];
      const y = x => strY(s,x);
      const sx = SCALE_LEN + SADDLE_COMP[s];
      const pts = [headW(...posts[s])];
      if(electric && s >= 4){ const t = 72/(-posts[s][0]); pts.push(headW(-72, y(0)+(posts[s][1]-y(0))*t, 6.2)); }
      pts.push([0, y(0), stringZ(0)+r]);
      const info = strInfo && strInfo[s];
      if(info) pts.push([info.contact, y(info.contact), FRET_TOP+r+0.15], [info.fret, y(info.fret), FRET_TOP+r]);
      pts.push([sx, y(sx), stringZ(sx)+r]);
      pts.push(electric ? [SCALE_LEN+35, y(SCALE_LEN), BODY_TOP+6.5] : [SCALE_LEN+16, y(SCALE_LEN), BODY_TOP+8.6]);
      segs.forEach((m,k)=>{ if(k < pts.length-1) placeSeg(m, pts[k], pts[k+1], r); else m.visible = false; });
    }
  }
  setStrings(null);

  /* ---------- 柄を変える（木目の絵は1回作ったら使い回す） ---------- */
  const topCache = new Map();
  let tort = null;
  function setFinish(name){
    const list = FINISHES[type], f = list[name] || Object.values(list)[0];
    const paint = (m, col, rough, metal=0) => { m.map = null; m.color.set(col); m.roughness = rough; m.metalness = metal; m.needsUpdate = true; };
    const woodOn = (m, tex, rough) => { m.map = tex; m.color.set('#ffffff'); m.roughness = rough; m.metalness = 0; m.needsUpdate = true; };
    // 表板（エレキはボディ全体）
    if(f.top || f.burst){ if(!topCache.has(name)) topCache.set(name, topTexture(f, box)); woodOn(topMat, topCache.get(name), f.rough); }
    else paint(topMat, f.paint, f.rough, f.metal || 0);
    if(!electric){
      const sd = f.side || f.top;
      if(sd.paint){ paint(sideMat, sd.paint, f.rough); paint(backMat, sd.paint, f.rough); }
      else { woodOn(sideMat, wood(sd), f.rough+0.04); woodOn(backMat, wood(sd), f.rough+0.04); }
    }
    // ピックガード
    if(f.guard === 'tort'){ tort ||= tortTexture(); guardMat.map = tort; guardMat.color.set('#ffffff'); }
    else { guardMat.map = null; guardMat.color.set(GUARD_COL[f.guard]); }
    guardMat.needsUpdate = true;
    // 指板（エレキはメイプルかローズウッド）
    const mapleFb = electric && f.fb === 'maple';
    fbMat.map = (mapleFb ? maple : rosewood).map; fbMat.roughness = mapleFb ? 0.3 : 0.55; fbMat.needsUpdate = true;
    dotMat.color.set(mapleFb ? '#17110d' : '#efeae0'); dotMat.needsUpdate = true;
    if(pickupMat){ const col = f.guard === 'black' ? '#141213' : '#f2efe6'; pickupMat.color.set(col); knobMat.color.set(col); }
  }
  return {group: g, setStrings, setFinish, type};
}
