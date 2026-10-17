/* =========================================================
   3D表示（three.js）：メイン画面と「輪切り」図
   ========================================================= */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { buildUkulele, neckSectionShape } from './uke.js';
import { loadHand, applyPose } from './handrig.js';
import { slotCenter, halfW, strY, stringZ, STRING_R, DEG } from './geom.js';
import { STRING_NAMES, FINGER_COLORS, FINGER_NAMES } from './data.js';

export const VIEWS = {
  diag:  {pol:50, az:-42, dist:260, up:[0,0,1],  name:'ななめ（手の形がいちばん分かりやすい）'},
  self:  {pol:46, az:-90, dist:320, up:[0,0,1],  name:'自分目線（弾いている人の目から）'},
  front: {pol:16, az:-80, dist:340, up:[0,-1,0], name:'正面（向かい合った先生から）'},
  side:  {pol:78, az:160, dist:320, up:[0,0,1],  name:'横から（ボディ側から）'}
};

export async function createView({mainCanvas, sideCanvas, mainOverlay, sideOverlay, onTap}){
  const mkRenderer = canvas => {
    const r = new THREE.WebGLRenderer({canvas, antialias:true, alpha:true});
    r.setPixelRatio(Math.min(window.devicePixelRatio||1, 2));
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.05;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.localClippingEnabled = true;
    return r;
  };
  const renderer = mkRenderer(mainCanvas);
  const sideRenderer = mkRenderer(sideCanvas);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;

  // 光：天井側・客席側からのやわらかい主光源＋まわりの反射
  scene.add(new THREE.HemisphereLight('#fff2e2', '#3b2617', 0.55));
  const key = new THREE.DirectionalLight('#fff3e4', 2.4);
  key.position.set(-160, -260, 420); key.target.position.set(60, 10, -10);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, {left:-170, right:170, top:170, bottom:-170, near:50, far:1200});
  key.shadow.bias = -0.0004; key.shadow.normalBias = 0.8; key.shadow.radius = 4;
  scene.add(key, key.target);
  const rim = new THREE.DirectionalLight('#ffd9b8', 0.6); rim.position.set(300, 200, 150); scene.add(rim);

  // ウクレレ
  const uke = buildUkulele();
  scene.add(uke.group);
  // 輪切り図用：手前を切る面と、奥（ボディ側）を切る面
  const clipPlane = new THREE.Plane(new THREE.Vector3(1,0,0), 1e5);
  const clipFar = new THREE.Plane(new THREE.Vector3(-1,0,0), 1e5);
  uke.clipMats.forEach(m=>{ m.clippingPlanes = [clipPlane, clipFar]; m.envMapIntensity = 0.5; });

  // 手：肌は少し透明感のある質感（光が当たる縁がほんのり赤くなる）
  const skin = new THREE.MeshPhysicalMaterial({
    color:'#e2a283', roughness:0.5, metalness:0,
    sheen:0.6, sheenRoughness:0.5, sheenColor:new THREE.Color('#ff9d80'),
    clearcoat:0.06, clearcoatRoughness:0.6, envMapIntensity:0.6
  });
  skin.onBeforeCompile = sh => {
    // 影の境目を赤みがかってやわらかくする（皮膚の下で光が散る感じ）
    sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
      float wrapL = clamp(dot(normal, normalize(vec3(-0.25,-0.45,0.85)))*0.5+0.5, 0.0, 1.0);
      reflectedLight.indirectDiffuse += diffuseColor.rgb * vec3(0.32,0.09,0.05) * (1.0-wrapL) * 0.9;`);
  };
  const rig = await loadHand(skin);
  scene.add(rig.root);
  // 輪切りの断面
  const cap = new THREE.Group(); cap.visible = false; scene.add(cap);
  const capNeck = new THREE.MeshStandardMaterial({color:'#a8713f', roughness:0.7, side:THREE.DoubleSide});
  const capBoard = new THREE.MeshStandardMaterial({color:'#4a2a18', roughness:0.7, side:THREE.DoubleSide});
  const capStr = new THREE.MeshBasicMaterial({color:'#fff7e0', side:THREE.DoubleSide});

  // カメラ
  const camera = new THREE.PerspectiveCamera(26, 16/9, 5, 4000);
  const sideCam = new THREE.PerspectiveCamera(20, 4/3, 5, 4000);
  let controls = null, viewName = 'diag', target = new THREE.Vector3(45, 10, -4), mirror = false;
  function setView(name){
    viewName = name;
    const v = VIEWS[name];
    const narrow = mainCanvas.clientWidth < 640;
    const d = v.dist * (narrow ? 0.92 : 1);
    const pol = v.pol*DEG, az = v.az*DEG;
    camera.up.set(...v.up);
    camera.position.copy(target).add(new THREE.Vector3(Math.sin(pol)*Math.cos(az), Math.sin(pol)*Math.sin(az), Math.cos(pol)).multiplyScalar(d));
    camera.lookAt(target);
    if(controls) controls.dispose();
    controls = new OrbitControls(camera, mainCanvas);
    controls.target.copy(target);
    controls.enablePan = false; controls.minDistance = 140; controls.maxDistance = 800;
    controls.rotateSpeed = 0.7; controls.zoomSpeed = 0.8;
    controls.addEventListener('change', ()=>requestRender && requestRender());
    controls.update();
  }
  let requestRender = null;
  // タップ（ドラッグしなかった時）で音を鳴らす
  let down = null;
  mainCanvas.addEventListener('pointerdown', e=>{ down = [e.clientX, e.clientY]; });
  mainCanvas.addEventListener('pointerup', e=>{ if(down && Math.hypot(e.clientX-down[0], e.clientY-down[1]) < 6) onTap && onTap(); down = null; });

  function fit(r, cam, canvas){
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const s = r.getSize(new THREE.Vector2());
    if(s.x !== w || s.y !== h){ r.setSize(w, h, false); cam.aspect = w/h; cam.updateProjectionMatrix(); }
    return [w, h];
  }
  const project = (cam, p, W, H) => { const v = new THREE.Vector3(...p).project(cam); if(v.z > 1) return null; return [(v.x+1)/2*W, (1-v.y)/2*H]; };

  function render(pose, opts){
    applyPose(rig, pose);
    uke.setStrings(pose.str);
    // コードが変わったら見る中心も少しずらす（カメラごと平行移動）
    const nt = new THREE.Vector3(...pose.target);
    if(nt.distanceTo(target) > 0.01){
      const delta = nt.clone().sub(target);
      target.copy(nt); controls.target.add(delta); camera.position.add(delta); controls.update();
    }
    // ---- メイン ----
    clipPlane.constant = 1e5; clipFar.constant = 1e5; cap.visible = false;
    const [W, H] = fit(renderer, camera, mainCanvas);
    mainCanvas.style.transform = opts.mirror ? 'scaleX(-1)' : '';
    renderer.render(scene, camera);
    let html = '';
    const P = p => { const q = project(camera, p, W, H); if(q && opts.mirror) q[0] = W - q[0]; return q; };
    const at = (q, cls, txt, style='') => { if(q && q[0]>-30 && q[0]<W+30 && q[1]>-30 && q[1]<H+30) html += `<div class="${cls}" style="left:${q[0].toFixed(1)}px;top:${q[1].toFixed(1)}px;${style}">${txt}</div>`; };
    for(let n=1; n<=5; n++) at(P([slotCenter(n), -halfW(slotCenter(n))-8, 0]), 'lab fret', n+'<small>フレット</small>');
    for(let s=0; s<4; s++){
      const open = pose.chord.frets[s]===0;
      at(P([-9, strY(s,0), stringZ(0)+3]), 'lab str'+(open?' open':''), STRING_NAMES[s]+(open?'<small>○</small>':''));
    }
    if(opts.badges){
      for(let f=1; f<=4; f++){
        const F = pose.fingers[f]; if(F.mode==='hover') continue;
        const q = P(F.pts[3]);
        if(q) at([q[0], q[1]-30], 'fbadge', f, `background:${FINGER_COLORS[f]}`);
      }
    }
    mainOverlay.innerHTML = html;

    // ---- 輪切り図 ----
    const fingers = pose.fingers;
    const active = [1,2,3,4].filter(f=>fingers[f].mode!=='hover');
    const focus = active.includes(opts.focus) ? opts.focus : (active[0]||0);
    let fx = slotCenter(1), fromHead = true;
    if(focus){
      fx = Math.min(fingers[focus].pts[3][0], fingers[focus].pts[2][0]);
      const before = active.filter(f=>f!==focus && fingers[f].pts[3][0] < fx-2).length;
      const after  = active.filter(f=>f!==focus && fingers[f].pts[3][0] > fx+2).length;
      fromHead = before <= after;
    }
    const cut = fromHead ? fx - 9 : fx + 9, dir = fromHead ? 1 : -1;
    clipPlane.normal.set(dir,0,0); clipPlane.constant = -dir*cut;
    clipFar.normal.set(-dir,0,0); clipFar.constant = dir*(cut + dir*70);   // 切り口から70mm先までだけ見せる
    cap.clear();
    const sh = neckSectionShape(cut);
    const basis = new THREE.Matrix4().makeBasis(new THREE.Vector3(0,1,0), new THREE.Vector3(0,0,1), new THREE.Vector3(1,0,0));
    const mk = (geo, mat, z=0) => { const m = new THREE.Mesh(geo, mat); m.matrixAutoUpdate = false;
      m.matrix.copy(basis).setPosition(cut - dir*(0.05+z), 0, 0); cap.add(m); };
    mk(new THREE.ShapeGeometry(sh), capNeck);
    const hw = halfW(cut);
    const bshape = new THREE.Shape(); bshape.moveTo(-hw,0); bshape.lineTo(hw,0); bshape.lineTo(hw,-5); bshape.lineTo(-hw,-5); bshape.closePath();
    mk(new THREE.ShapeGeometry(bshape), capBoard, 0.02);
    for(let s=0;s<4;s++){
      const info = pose.str[s];
      let z = stringZ(cut) + STRING_R[s];
      if(info && cut > Math.min(info.contact, info.fret)-1 && cut < Math.max(info.contact, info.fret)+1) z = 1.25+STRING_R[s];
      const c = new THREE.Mesh(new THREE.CircleGeometry(STRING_R[s]*1.6, 12), capStr);
      c.matrixAutoUpdate = false; c.matrix.copy(basis).setPosition(cut - dir*0.1, strY(s,cut), z); cap.add(c);
    }
    cap.visible = true;
    const st = new THREE.Vector3(cut, 16, 4);
    sideCam.up.set(0,0,1);
    sideCam.position.set(cut - dir*240, 26, 34);
    sideCam.lookAt(st);
    const [sw, shh] = fit(sideRenderer, sideCam, sideCanvas);
    sideRenderer.render(scene, sideCam);
    cap.visible = false; clipPlane.constant = 1e5; clipFar.constant = 1e5;
    let sh2 = '';
    for(let s=0; s<4; s++){
      const q = project(sideCam, [cut, strY(s,cut), 10], sw, shh);
      if(q) sh2 += `<div class="lab str" style="left:${q[0].toFixed(1)}px;top:${q[1].toFixed(1)}px">${STRING_NAMES[s]}</div>`;
    }
    sh2 += focus ? `<div class="sidetag" style="background:${FINGER_COLORS[focus]}">${focus} ${FINGER_NAMES[focus]}</div>`
                 : `<div class="sidetag" style="background:#ffd36b">どこも押さえません</div>`;
    sideOverlay.innerHTML = sh2;
  }

  setView('diag');
  return {
    render, setView, rig,
    debugCam(pos, look){ camera.position.set(...pos); controls.target.set(...look); controls.update(); },
    onChange(fn){ requestRender = fn; },
    get viewName(){ return viewName; }
  };
}
