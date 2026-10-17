/* =========================================================
   背景：波打ち際（砂浜・波の泡・海・空）
   画像ファイルは使わず、その場で描いた絵を貼るだけ（軽い・止まっている）
   ウクレレは砂浜に置いてあるイメージ。z が上（空）
   ========================================================= */
import * as THREE from 'three';

function rng(seed){ return ()=>{ seed=(seed*16807)%2147483647; return (seed-1)/2147483646; }; }

// 地面：手前が乾いた砂 → 濡れた砂 → 泡の線 → 浅瀬（エメラルド）→ 沖（濃い青）
function groundTexture(){
  const W = 2048, H = 2048, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'), r = rng(7);
  // テクスチャの上側（v=1）が沖。岸の線は v≈0.62
  const shore = H*0.38;
  const grd = g.createLinearGradient(0, H, 0, 0);
  grd.addColorStop(0.00, '#cdb88f'); grd.addColorStop(0.50, '#c9b38a');
  grd.addColorStop(0.58, '#b39d74'); grd.addColorStop(0.615, '#9c8763');   // 濡れた砂
  grd.addColorStop(0.63, '#cfe9e4'); grd.addColorStop(0.66, '#7fd3cc');    // 泡〜浅瀬
  grd.addColorStop(0.75, '#2fb3b8'); grd.addColorStop(0.88, '#16869f'); grd.addColorStop(1.00, '#0d5f82');
  g.fillStyle = grd; g.fillRect(0, 0, W, H);
  // 砂の粒
  for(let i=0;i<60000;i++){
    const x = r()*W, y = shore + r()*(H-shore);
    g.fillStyle = r()<0.5 ? 'rgba(255,255,255,0.18)' : 'rgba(120,95,60,0.14)';
    g.fillRect(x, y, 1+r()*1.5, 1+r()*1.5);
  }
  // 波の泡（岸に沿ったゆらゆらの白い線）
  const wave = (y0, amp, a, w) => {
    g.strokeStyle = `rgba(255,255,255,${a})`; g.lineWidth = w; g.beginPath();
    const ph = r()*6.28, f1 = 3+r()*3, f2 = 11+r()*6;
    for(let x=0;x<=W;x+=8){ const y = y0 + Math.sin(x/W*6.28*f1+ph)*amp + Math.sin(x/W*6.28*f2+ph*2)*amp*0.35; x?g.lineTo(x,y):g.moveTo(x,y); }
    g.stroke();
  };
  wave(shore+6, 10, 0.95, 7); wave(shore+2, 12, 0.6, 3); wave(shore-26, 14, 0.45, 4);
  wave(shore-70, 18, 0.28, 3); wave(shore-140, 22, 0.16, 3); wave(shore-260, 26, 0.10, 3);
  // 水面のきらめき
  for(let i=0;i<2500;i++){ const x = r()*W, y = r()*(shore-30); g.fillStyle = `rgba(255,255,255,${0.08+r()*0.25})`; g.fillRect(x, y, 2+r()*8, 1); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

// 空：上が青、地平線がかすむ
function skyTexture(){
  const c = document.createElement('canvas'); c.width = 16; c.height = 512;
  const g = c.getContext('2d'), grd = g.createLinearGradient(0, 0, 0, 512);
  grd.addColorStop(0, '#5fb6e6'); grd.addColorStop(0.45, '#a9dcf2'); grd.addColorStop(0.5, '#e6f6f8'); grd.addColorStop(1, '#e6f6f8');
  g.fillStyle = grd; g.fillRect(0, 0, 16, 512);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function addBeach(scene){
  const grp = new THREE.Group();
  const SIZE = 7000;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE),
    new THREE.MeshStandardMaterial({map: groundTexture(), roughness: 1, metalness: 0, envMapIntensity: 0.3}));
  ground.position.set(-300, -540, -82);                   // 海は +y の奥（よく見る向きの先）。波打ち際はウクレレから約45cm先
  ground.receiveShadow = true;
  grp.add(ground);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(3600, 32, 16),
    new THREE.MeshBasicMaterial({map: skyTexture(), side: THREE.BackSide, depthWrite: false, fog: false}));
  sky.rotation.x = Math.PI/2;                             // 球の上（+y）を空の上（+z）に向ける
  grp.add(sky);
  scene.add(grp);
  scene.fog = new THREE.Fog('#e6f6f8', 1400, 3400);
  scene.background = new THREE.Color('#e6f6f8');
  return grp;
}
