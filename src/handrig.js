/* =========================================================
   手の3Dモデル（関節に骨が入ったもの）を読み込んで動かす
   モデル：WebXR Input Profiles「generic-hand」左手（MIT License, Copyright (c) 2019 Amazon）
   関節の向きのルール（WebXR）：-Z が指先の方向、+Y が手の甲の方向
   ========================================================= */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import handGlb from '../node_modules/@webxr-input-profiles/assets/dist/profiles/generic-hand/left.glb';
import { sub, vlen, norm, cross, dot, mul } from './geom.js';
import { smoothSkinnedGeometry } from './subdivide.js';

export const FINGER_KEYS = ['', 'index', 'middle', 'ring', 'pinky'];
const FINGER_JOINTS = ['metacarpal','phalanx-proximal','phalanx-intermediate','phalanx-distal','tip'];
export const THUMB_JOINTS = ['thumb-metacarpal','thumb-phalanx-proximal','thumb-phalanx-distal','thumb-tip'];
export const jointName = (f, i) => `${FINGER_KEYS[f]}-finger-${FINGER_JOINTS[i]}`;

export async function loadHand(skinMaterial){
  const gltf = await new Promise((res, rej)=>new GLTFLoader().parse(handGlb.buffer.slice(handGlb.byteOffset, handGlb.byteOffset+handGlb.byteLength), '', res, rej));
  const root = new THREE.Group();
  root.scale.setScalar(1000);              // モデルはメートル、この画面はmm
  root.add(gltf.scene);
  const bones = {};
  let mesh = null;
  gltf.scene.traverse(o=>{
    if(o.isBone || (o.name && /finger|thumb|wrist/.test(o.name) && !o.isMesh)) bones[o.name] = o;
    if(o.isSkinnedMesh) mesh = o;
  });
  mesh.geometry = smoothSkinnedGeometry(mesh.geometry, 2);
  mesh.material = skinMaterial;
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.frustumCulled = false;

  // 基本姿勢での関節位置（手首から見た位置, mm）
  const wrist = bones['wrist'];
  const wq = wrist.quaternion.clone(), wqi = wq.clone().invert(), wp = wrist.position.clone();
  const rest = {};
  for(const name in bones){
    const v = bones[name].position.clone().sub(wp).applyQuaternion(wqi).multiplyScalar(1000);
    rest[name] = [v.x, v.y, v.z];
  }
  const P = n => rest[n];
  const dist = (a,b) => vlen(sub(P(a),P(b)));
  // 骨の長さ（このモデルの実寸）
  const lengths = {};
  for(let f=1; f<=4; f++) lengths[f] = [1,2,3].map(i=>dist(jointName(f,i), jointName(f,i+1)));
  const thumbLengths = [0,1,2].map(i=>dist(THUMB_JOINTS[i], THUMB_JOINTS[i+1]));

  const m4 = new THREE.Matrix4(), vx = new THREE.Vector3(), vy = new THREE.Vector3(), vz = new THREE.Vector3();
  function setBone(name, pos, fwd, dorsal){
    const b = bones[name]; if(!b) return;
    b.position.set(pos[0]/1000, pos[1]/1000, pos[2]/1000);
    const z = norm(mul(fwd,-1));
    let y = sub(dorsal, mul(z, dot(dorsal,z)));
    y = vlen(y) < 1e-4 ? norm(cross(z,[1,0,0])) : norm(y);
    const x = cross(y, z);
    vx.set(...x); vy.set(...y); vz.set(...z);
    m4.makeBasis(vx, vy, vz);
    b.quaternion.setFromRotationMatrix(m4);
  }
  return { root, mesh, bones, rest, lengths, thumbLengths, setBone };
}

// ポーズ（関節の位置と向き）をモデルに反映
export function applyPose(rig, pose){
  for(const j of pose.joints) rig.setBone(j.name, j.pos, j.fwd, j.dorsal);
}
