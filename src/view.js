/* =========================================================
   3D表示（three.js）：メイン画面と「輪切り」図
   ========================================================= */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { buildUkulele, neckSectionShape } from './uke.js';
import { loadHand, applyPose } from './handrig.js';
import { rightHandPose, STRUM_X } from './strum.js';
import { slotCenter, halfW, strY, stringZ, STRING_R, FRET_TOP, DEG } from './geom.js';
import { STRING_NAMES, FINGER_COLORS, FINGER_NAMES } from './data.js';

export const VIEWS = {
  diag:  {label:'ななめ', pol:50, az:-42, dist:260, up:[0,0,1],  name:'ななめ（手の形がいちばん分かりやすい）'},
  self:  {label:'自分目線', pol:46, az:-90, dist:320, up:[0,0,1],  name:'自分目線（弾いている人の目から）'},
  front: {label:'正面', pol:16, az:-80, dist:340, up:[0,-1,0], name:'正面（向かい合った先生から）'},
  side:  {label:'横から', pol:78, az:160, dist:320, up:[0,0,1],  name:'横から（ボディ側から）'},
  both:  {label:'両手', pol:44, az:-78, dist:720, up:[0,0,1],  name:'両手（全体を見る）', fixed:[150, 15, -10]},
  right: {label:'右手', pol:62, az:-118, dist:400, up:[0,0,1],  name:'右手（ストロークを見る）', fixed:[STRUM_X, 0, 25]}
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
  /* 腕は手首の少し先までだけ見せる：手首から30〜85mmの間で、だんだん透明にして消す */
  function addArmFade(mat, rig, depthOnly){
    const prev = mat.onBeforeCompile;
    mat.onBeforeCompile = (sh, r) => {
      prev && prev.call(mat, sh, r);
      sh.uniforms.uWristP = {value: rig.fade.p}; sh.uniforms.uWristZ = {value: rig.fade.z};
      sh.vertexShader = 'uniform vec3 uWristP; uniform vec3 uWristZ; varying float vAlong;\n' +
        sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vAlong = dot(position - uWristP, uWristZ);');
      sh.fragmentShader = 'varying float vAlong;\n' +
        sh.fragmentShader.replace('#include <alphatest_fragment>', `#include <alphatest_fragment>
          float armFade = 1.0 - smoothstep(0.03, 0.085, vAlong);
          ${depthOnly ? 'if(armFade < 0.6) discard;' : 'diffuseColor.a *= armFade*armFade*(3.0-2.0*armFade); if(diffuseColor.a < 0.004) discard;'}`);
    };
    mat.customProgramCacheKey = () => 'armfade-' + mat.uuid;
  }
  const skinLight = skin.onBeforeCompile;   // 右手にも同じ肌の質感を使う
  const rig = await loadHand(skin);
  addArmFade(skin, rig);
  scene.add(rig.root);
  // 半透明の手：先に「奥行きだけ」を描いてから、いちばん手前の皮膚だけを半透明で描く（指が重なってもにごらない）
  const depthMat = new THREE.MeshBasicMaterial({colorWrite:false});
  const handDepth = new THREE.SkinnedMesh(rig.mesh.geometry, depthMat);
  handDepth.bind(rig.mesh.skeleton, rig.mesh.bindMatrix);
  addArmFade(depthMat, rig, true);
  handDepth.frustumCulled = false; handDepth.renderOrder = 1; handDepth.visible = false;
  rig.mesh.parent.add(handDepth);
  function setGhost(on){
    skin.transparent = true; skin.opacity = on ? 0.6 : 1; skin.depthWrite = !on;   // 腕の先を消すので、いつも透明あり
    skin.emissive.set(on ? '#5a2a18' : '#000000');
    rig.mesh.renderOrder = on ? 2 : 0; handDepth.visible = on;
    rig.mesh.castShadow = !on;
    skin.needsUpdate = true;
  }

  // 押さえる場所の印（指の色の丸）と、弦に当たっているところの光る輪
  const marks = new THREE.Group(); scene.add(marks);
  const markMats = FINGER_COLORS.map(c => c ? new THREE.MeshBasicMaterial({color:c, transparent:true, opacity:0.9, depthWrite:false}) : null);
  const ringMats = FINGER_COLORS.map(c => c ? new THREE.MeshBasicMaterial({color:c, transparent:true, opacity:1, depthTest:false}) : null);
  const glowTex = (()=>{ const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
    const gr = g.createRadialGradient(32,32,0,32,32,32); gr.addColorStop(0,'rgba(255,255,255,1)'); gr.addColorStop(.35,'rgba(255,255,255,.6)'); gr.addColorStop(1,'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0,0,64,64); return new THREE.CanvasTexture(c); })();
  function placeMarks(pose, ghost){
    marks.clear();
    const chord = pose.chord;
    for(let s=0;s<4;s++){
      const info = pose.str[s]; if(!info) continue;
      const f = chord.fingers[s] || 1;
      const x = info.contact, y = strY(s, x);
      // 指板の上の丸
      const disc = new THREE.Mesh(new THREE.CircleGeometry(4.6, 32), markMats[f]);
      disc.position.set(x, y, 0.08); disc.renderOrder = 3; marks.add(disc);
      // 弦が指に当たって沈んでいるところ：光る輪（手を透かして見えるように、いちばん手前に描く）
      const ring = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.45, 8, 28), ringMats[f]);
      ring.position.set(x, y, FRET_TOP + STRING_R[s] + 0.2); ring.rotation.y = Math.PI/2; ring.renderOrder = 10;
      ring.visible = ghost; marks.add(ring);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({map:glowTex, color:FINGER_COLORS[f], transparent:true, depthTest:false, depthWrite:false, opacity: ghost ? 0.9 : 0.0}));
      glow.position.set(x, y, FRET_TOP + 1.2); glow.scale.set(13,13,1); glow.renderOrder = 9; marks.add(glow);
    }
  }
  // 右手（ストローク用）。肌の質感は左手と同じ
  const skinR = skin.clone(); skinR.onBeforeCompile = skinLight;
  const rigR = await loadHand(skinR, 'right');
  addArmFade(skinR, rigR); skinR.transparent = true;
  scene.add(rigR.root);

  // 輪切りの断面
  const cap = new THREE.Group(); cap.visible = false; scene.add(cap);
  const capNeck = new THREE.MeshStandardMaterial({color:'#a8713f', roughness:0.7, side:THREE.DoubleSide});
  const capBoard = new THREE.MeshStandardMaterial({color:'#4a2a18', roughness:0.7, side:THREE.DoubleSide});
  const capStr = new THREE.MeshBasicMaterial({color:'#fff7e0', side:THREE.DoubleSide});

  // カメラ
  const camera = new THREE.PerspectiveCamera(26, 16/9, 5, 4000);
  const sideCam = new THREE.PerspectiveCamera(20, 4/3, 5, 4000);
  let controls = null, viewName = 'diag', target = new THREE.Vector3(45, 10, -4), mirror = false;
  // カメラの操作：1本指（左ドラッグ）で回す、2本指（右ドラッグ）で平行移動、ピンチ（ホイール）で拡大
  function makeControls(cam, tgt){
    const c = new OrbitControls(cam, mainCanvas);
    c.target.copy(tgt);
    c.enablePan = true; c.screenSpacePanning = true; c.panSpeed = 0.8;
    c.minDistance = 120; c.maxDistance = 900;
    c.rotateSpeed = 0.7; c.zoomSpeed = 0.8;
    c.touches = {ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN};
    c.addEventListener('change', ()=>requestRender && requestRender());
    c.update();
    return c;
  }
  function placeCam(cam, tgt, name, scale=1){
    const v = VIEWS[name];
    if(v.fixed) tgt.set(...v.fixed);
    const narrow = mainCanvas.clientWidth < 640;
    const d = v.dist * (narrow ? 0.92 : 1) * scale;
    const pol = v.pol*DEG, az = v.az*DEG;
    cam.up.set(...v.up);
    cam.position.copy(tgt).add(new THREE.Vector3(Math.sin(pol)*Math.cos(az), Math.sin(pol)*Math.sin(az), Math.cos(pol)).multiplyScalar(d));
    cam.lookAt(tgt);
  }
  function setView(name){
    viewName = name;
    if(lastT && !VIEWS[name].fixed) target.copy(lastT);
    placeCam(camera, target, name);
    if(controls) controls.dispose();
    controls = makeControls(camera, target);
  }
  // 2画面表示：右半分にもう1つの向きを同時に出す（右側もドラッグで回せる）
  const camera2 = new THREE.PerspectiveCamera(26, 1, 5, 4000);
  let view2 = 'front', controls2 = null, splitOn = false;
  const target2 = new THREE.Vector3(45, 10, -4);
  function setView2(name){
    view2 = name;
    if(!VIEWS[name].fixed) target2.copy(lastT || target);
    placeCam(camera2, target2, name, 0.9);
    if(controls2) controls2.dispose();
    controls2 = makeControls(camera2, target2);
    controls2.enabled = false;
  }
  // どちらの画面を触ったかで、動かすカメラを切り替える（OrbitControls より先に判定）
  let activePtr = 0, lastT = null;
  const pickSide = e => {
    const r = mainCanvas.getBoundingClientRect();
    let x = e.clientX - r.left; if(mainCanvas.style.transform) x = r.width - x;
    const right = splitOn && x > r.width/2;
    controls.enabled = !right; if(controls2) controls2.enabled = right;
  };
  mainCanvas.parentElement.addEventListener('pointerdown', e=>{ if(activePtr++ === 0) pickSide(e); }, true);
  window.addEventListener('pointerup', ()=>{ activePtr = Math.max(0, activePtr-1); }, true);
  window.addEventListener('pointercancel', ()=>{ activePtr = Math.max(0, activePtr-1); }, true);
  mainCanvas.parentElement.addEventListener('wheel', e=>{ if(activePtr === 0) pickSide(e); }, true);
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

  const basePR = Math.min(window.devicePixelRatio||1, 2);
  let curPR = basePR;
  function render(pose, opts){
    // 動いている間は解像度を少し下げる（重い端末でカクカクしないように）
    const pr = Math.max(0.75, Math.round(basePR*(opts.quality ?? 1)*20)/20);
    if(pr !== curPR){ curPR = pr; renderer.setPixelRatio(pr); }
    applyPose(rig, pose);
    uke.setStrings(pose.str);
    setGhost(!!opts.ghost);
    placeMarks(pose, !!opts.ghost);
    // 右手
    rigR.root.visible = !!opts.right;
    if(opts.right){ const rp = rightHandPose(rigR, opts.right); window.__rp = rp; applyPose(rigR, rp); }
    // コードが変わったら見る中心も少しずらす（カメラごと平行移動）。全体・右手の表示では動かさない
    const nt = new THREE.Vector3(...pose.target);
    if(!lastT) lastT = nt.clone();
    if(nt.distanceTo(lastT) > 0.01){
      const delta = nt.clone().sub(lastT); lastT.copy(nt);
      if(!VIEWS[viewName].fixed){ controls.target.add(delta); camera.position.add(delta); controls.update(); }
      if(controls2 && !VIEWS[view2].fixed){ controls2.target.add(delta); camera2.position.add(delta); controls2.update(); }
    }
    // ---- メイン ----
    clipPlane.constant = 1e5; clipFar.constant = 1e5; cap.visible = false;
    const [Wc, H] = fit(renderer, camera, mainCanvas);
    mainCanvas.style.transform = opts.mirror ? 'scaleX(-1)' : '';
    let W = Wc;
    if(opts.split){
      // 左右に分けて2つの向きを描く
      W = Math.floor(Wc/2);
      camera.aspect = W/H; camera.updateProjectionMatrix();
      camera2.aspect = (Wc-W)/H; camera2.updateProjectionMatrix();
      renderer.setScissorTest(true);
      renderer.setViewport(0, 0, W, H); renderer.setScissor(0, 0, W, H);
      renderer.render(scene, camera);
      renderer.setViewport(W, 0, Wc-W, H); renderer.setScissor(W, 0, Wc-W, H);
      renderer.render(scene, camera2);
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, Wc, H);
    } else {
      if(Math.abs(camera.aspect - Wc/H) > 1e-3){ camera.aspect = Wc/H; camera.updateProjectionMatrix(); }
      renderer.render(scene, camera);
    }
    let html = '';
    const P = p => { const q = project(camera, p, W, H); if(q && opts.mirror) q[0] = Wc - q[0]; return q; };
    const at = (q, cls, txt, style='') => { if(q && q[0]>-30 && q[0]<W-10 && q[1]>-30 && q[1]<H+30) html += `<div class="${cls}" style="left:${q[0].toFixed(1)}px;top:${q[1].toFixed(1)}px;${style}">${txt}</div>`; };
    const showLabels = !VIEWS[viewName].fixed;
    if(showLabels) for(let n=1; n<=5; n++) at(P([slotCenter(n), -halfW(slotCenter(n))-8, 0]), 'lab fret', n+'<small>フレット</small>');
    if(showLabels) for(let s=0; s<4; s++){
      const open = pose.chord.frets[s]===0;
      at(P([-9, strY(s,0), stringZ(0)+3]), 'lab str'+(open?' open':''), STRING_NAMES[s]+(open?'<small>○</small>':''));
    }
    if(opts.badges){
      for(let f=1; f<=4; f++){
        const F = pose.fingers[f]; if(F.mode==='hover') continue;
        const q = P(F.pts[3]);
        if(q) at([q[0], q[1]-30], 'fbadge', f, `background:${FINGER_COLORS[f]}`);
        if(opts.split){   // 右側の画面にも指番号
          const q2 = project(camera2, F.pts[3], Wc-W, H);
          if(q2 && q2[0]>0 && q2[0]<Wc-W) html += `<div class="fbadge" style="left:${(q2[0]+W).toFixed(1)}px;top:${(q2[1]-30).toFixed(1)}px;background:${FINGER_COLORS[f]}">${f}</div>`;
        }
      }
    }
    if(opts.split) html += `<div class="splitline" style="left:${W}px"></div>`;
    if(mainOverlay._html !== html){ mainOverlay._html = html; mainOverlay.innerHTML = html; }   // 変わった時だけ書き換える
    if(opts.skipSide || sideCanvas.clientWidth === 0) return;   // 輪切り図が見えていない時は描かない

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
    const rv = rigR.root.visible; rigR.root.visible = false;
    sideRenderer.render(scene, sideCam);
    rigR.root.visible = rv;
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

  setView('diag'); setView2('front');
  return {
    render, setView, rig, rigR, rightHandPose,
    setView2, get cams(){ return [camera.position.toArray(), camera2.position.toArray(), controls.target.toArray()]; },
    setSplit(on){ splitOn = on; if(!on){ controls.enabled = true; if(controls2) controls2.enabled = false; } },
    debugCam(pos, look){ camera.position.set(...pos); controls.target.set(...look); controls.update(); },
    onChange(fn){ requestRender = fn; },
    get viewName(){ return viewName; }
  };
}
