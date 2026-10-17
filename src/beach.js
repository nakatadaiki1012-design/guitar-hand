/* =========================================================
   背景：砂浜（実物の大きさ）
   ウクレレは立てて構えている。空（上）は -y、客席（正面）は +z、
   弾く人の後ろ（-z）の先に波打ち際と海、その先に水平線
   単位はmm。地面はウクレレの約0.9m下（立って胸の前で構えた高さ）
   画像ファイルは使わず、その場で描いた絵を貼るだけ（軽い・止まっている）
   ========================================================= */
import * as THREE from 'three';

function rng(seed){ return ()=>{ seed=(seed*16807)%2147483647; return (seed-1)/2147483646; }; }

const GROUND_Y = 900;          // 地面の高さ（ウクレレの中心から下へ90cm）
const SHORE_Z = -2600;         // 波打ち際（弾く人の後ろ2.6m）
const NEAR_Z = 9000, FAR_Z = -16000, HALF_X = 16000;

/* 砂の粒（近くで見た時の細かい模様）：40cm角をくり返し貼る */
function grainTexture(){
  const N = 512, c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d'), r = rng(11);
  g.fillStyle = '#d9c7a0'; g.fillRect(0, 0, N, N);
  // 色の違う粒（白っぽい石英・茶色・黒っぽい粒・貝のかけら）
  const cols = ['rgba(255,250,235,0.35)','rgba(170,138,98,0.25)','rgba(120,100,80,0.18)','rgba(235,215,180,0.4)','rgba(90,80,75,0.12)'];
  for(let i=0;i<30000;i++){
    const x = r()*N, y = r()*N, s = 0.5+r()*1.1;
    g.fillStyle = cols[(r()*cols.length)|0];
    g.beginPath(); g.arc(x, y, s, 0, 6.283); g.fill();
  }
  // ところどころの小さな貝殻のかけら
  for(let i=0;i<40;i++){
    const x = r()*N, y = r()*N;
    g.fillStyle = `rgba(250,240,225,${0.5+r()*0.4})`;
    g.beginPath(); g.ellipse(x, y, 1.5+r()*3, 1+r()*2, r()*3, 0, 6.283); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

/* 砂浜全体（遠くから見た時の模様）：乾いた砂 → 風紋 → 濡れた砂 → 泡 → 浅瀬 → 沖
   テクスチャの v=0 が手前（NEAR_Z）、v=1 が沖（FAR_Z） */
function shoreTexture(){
  const W = 1024, H = 2048, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'), r = rng(5);
  const vOf = z => (NEAR_Z - z)/(NEAR_Z - FAR_Z);      // z → 0..1（上が沖）
  const yOf = z => H*(1 - vOf(z));
  const shoreY = yOf(SHORE_Z);
  const grd = g.createLinearGradient(0, H, 0, 0);
  const st = (z, col) => grd.addColorStop(Math.min(1, Math.max(0, vOf(z))), col);
  st(NEAR_Z, '#fbf3e2'); st(0, '#fbf3e2'); st(-1500, '#f6ead2');
  st(SHORE_Z+500, '#d9c6a2'); st(SHORE_Z+60, '#b9a27c');                     // 濡れた砂
  st(SHORE_Z, '#eaf3ee'); st(SHORE_Z-250, '#bfe6df'); st(SHORE_Z-900, '#74cdc8');   // 泡 → 浅瀬
  st(SHORE_Z-3000, '#2fa9b5'); st(SHORE_Z-7000, '#167f9e'); st(FAR_Z, '#0f6b8e');
  g.fillStyle = grd; g.fillRect(0, 0, W, H);
  // 乾いた砂のまだら（明るさのゆらぎ）
  for(let i=0;i<900;i++){
    const x = r()*W, y = shoreY + 40 + r()*(H-shoreY-40), rr = 20+r()*90;
    g.fillStyle = r()<0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(140,110,70,0.05)';
    g.beginPath(); g.ellipse(x, y, rr*1.6, rr, 0, 0, 6.283); g.fill();
  }
  // 風紋（風でできる細い波の筋）
  g.lineWidth = 1.2;
  for(let i=0;i<260;i++){
    const y0 = shoreY + 80 + r()*(H-shoreY-80), x0 = r()*W, len = 60+r()*220, ph = r()*6;
    g.strokeStyle = `rgba(150,120,80,${0.05+r()*0.06})`; g.beginPath();
    for(let k=0;k<=len;k+=6){ const x = x0+k, y = y0 + Math.sin(k/40+ph)*3; k?g.lineTo(x,y):g.moveTo(x,y); }
    g.stroke();
  }
  // 波の泡（岸に沿ったゆらゆらの白い線）
  const wave = (y0, amp, a, w) => {
    g.strokeStyle = `rgba(255,255,255,${a})`; g.lineWidth = w; g.beginPath();
    const ph = r()*6.28, f1 = 2+r()*2, f2 = 9+r()*5;
    for(let x=0;x<=W;x+=4){ const y = y0 + Math.sin(x/W*6.28*f1+ph)*amp + Math.sin(x/W*6.28*f2+ph*2)*amp*0.3; x?g.lineTo(x,y):g.moveTo(x,y); }
    g.stroke();
  };
  wave(shoreY+3, 5, 0.95, 4); wave(shoreY-4, 6, 0.6, 2);
  wave(shoreY-22, 7, 0.45, 3); wave(shoreY-50, 8, 0.3, 2); wave(shoreY-110, 9, 0.18, 2); wave(shoreY-200, 10, 0.1, 2);
  // 水面のきらめき
  for(let i=0;i<3000;i++){ const x = r()*W, y = r()*(shoreY-20); g.fillStyle = `rgba(255,255,255,${0.05+r()*0.18})`; g.fillRect(x, y, 1+r()*5, 1); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

// 空：真上が青、地平線に向かって白くかすむ（v=1 が真上）
function skyTexture(){
  const c = document.createElement('canvas'); c.width = 4; c.height = 512;
  const g = c.getContext('2d'), grd = g.createLinearGradient(0, 512, 0, 0);
  grd.addColorStop(0, '#dff1f4'); grd.addColorStop(0.5, '#dff1f4'); grd.addColorStop(0.53, '#cdeaf3');
  grd.addColorStop(0.62, '#9fd3ee'); grd.addColorStop(1, '#4f9fd8');
  g.fillStyle = grd; g.fillRect(0, 0, 4, 512);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function addBeach(scene){
  const grp = new THREE.Group();
  // 地面（xz の平面を y=GROUND_Y に。表は空の方 -y を向く）
  const geo = new THREE.PlaneGeometry(2*HALF_X, NEAR_Z - FAR_Z);
  geo.rotateX(Math.PI/2);                                   // 法線 +z → -y（上向き）
  const grain = grainTexture();
  grain.repeat.set(2*HALF_X/400, (NEAR_Z - FAR_Z)/400);     // 粒の模様は40cmごとにくり返し
  const mat = new THREE.MeshLambertMaterial({map: grain});
  const shore = shoreTexture();
  const vS = (NEAR_Z - SHORE_Z)/(NEAR_Z - FAR_Z);          // 波打ち際の位置（0〜1）
  // 粒の模様 × 砂浜全体の模様（2枚を重ねる。遠くは粒がつぶれるので全体の色だけに近づける）
  mat.onBeforeCompile = sh => {
    sh.uniforms.uShore = {value: shore};
    sh.vertexShader = 'varying vec2 vShoreUv;\n' + sh.vertexShader.replace('#include <uv_vertex>',
      `#include <uv_vertex>\n vShoreUv = vec2(uv.x, 1.0 - uv.y);`);
    sh.fragmentShader = 'uniform sampler2D uShore; varying vec2 vShoreUv;\n' + sh.fragmentShader.replace('#include <map_fragment>',
      `vec4 grainC = texture2D(map, vMapUv);
       vec4 shoreC = texture2D(uShore, vShoreUv);
       float far = smoothstep(2500.0, 9000.0, vViewDist);
       vec3 detail = mix(grainC.rgb / vec3(0.69, 0.57, 0.35), vec3(1.0), far);
       float land = 1.0 - smoothstep(${(vS-0.006).toFixed(4)}, ${(vS+0.002).toFixed(4)}, vShoreUv.y);
       diffuseColor.rgb *= shoreC.rgb * mix(vec3(1.0), detail, land);`)
      .replace('void main() {', 'varying float vViewDist;\nvoid main() {');
    sh.vertexShader = 'varying float vViewDist;\n' + sh.vertexShader.replace('#include <fog_vertex>', '#include <fog_vertex>\n vViewDist = -mvPosition.z;');
  };
  const ground = new THREE.Mesh(geo, mat);
  ground.position.set(0, GROUND_Y, (NEAR_Z + FAR_Z)/2);
  grp.add(ground);
  // 沖：地面のさらに先から水平線まで
  const seaGeo = new THREE.PlaneGeometry(2*HALF_X*4, 60000); seaGeo.rotateX(Math.PI/2);
  const sea = new THREE.Mesh(seaGeo, new THREE.MeshLambertMaterial({color:'#0f6b8e'}));
  sea.position.set(0, GROUND_Y + 2, FAR_Z - 30000 + 10);
  grp.add(sea);
  // 空（大きな球の内側。球の上 +y を空の上 -y に向ける）
  const sky = new THREE.Mesh(new THREE.SphereGeometry(50000, 32, 16),
    new THREE.MeshBasicMaterial({map: skyTexture(), side: THREE.BackSide, depthWrite: false, fog: false}));
  sky.rotation.x = Math.PI;
  sky.position.y = GROUND_Y;
  grp.add(sky);
  scene.add(grp);
  scene.fog = new THREE.Fog('#dff1f4', 6000, 42000);
  scene.background = new THREE.Color('#dff1f4');
  return grp;
}
