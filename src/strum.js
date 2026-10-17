/* =========================================================
   右手のストローク
   ・手の形：ピックを軽く持つような形。人差し指は丸めて、第一関節〜爪の背中側で弦をこする。中指〜小指はその後ろに軽く握り込む。
             親指の腹は人差し指の第一関節の横にそっと当てる
   ・腕の向き：前腕はウクレレの尾側（ボディのおしり側）から来て、ボディの上の縁にのせる
   ・動き　：ひじの先あたりを中心に、手首から先を振り子のように振る
             ダウン（4弦→1弦）は人差し指の爪、アップ（1弦→4弦）は指の腹で弦をこする
   ・弾かない拍（空ピッキング）でも手は止めず、弦から少し浮かせて振り続ける
   ========================================================= */
import { fretX, strY, stringZ, add, sub, mul, dot, cross, norm, vlen, DEG } from './geom.js';
import { jointName, THUMB_JOINTS } from './handrig.js';
import { makeThumbModel, solveThumbTo } from './thumb.js';

export const STRUM_X = fretX(16.5);          // 弾く場所：ネックとボディのつなぎ目あたり
export const STRUM_AMP = 0.30;               // 振りの大きさ（ラジアン）

const CFG = {
  wristFlex: 32,                             // 手首は手のひら側へ軽く曲げるだけ（横には曲げない）
  palm: [0, -0.15, -1],                      // 手のひらはボディの方を向く（手の甲は客席側）
  curl:  {1:[30,70,75], 2:[66,95,55], 3:[72,98,55], 4:[76,98,55]},  // 指の曲げ（付け根・第二・第一関節）
  splay: {1:6, 2:0, 3:-7, 4:-15},            // 指を軽く寄せる（度）
  pivotUp: 120,                              // 振りの中心：弦から客席側へ何mmか
  elbow: [0.55, -0.50, -0.67],               // 手首→ひじの向き：前腕はウクレレの尾側から、ボディの上の縁にのせて斜めに来る
};

const R3 = (axis, a, v) => { const k = norm(axis), c = Math.cos(a), s = Math.sin(a);
  return add(add(mul(v,c), mul(cross(k,v),s)), mul(k, dot(k,v)*(1-c))); };

// 手首を原点にした「手の中の座標」での関節（1回だけ計算）
function localHand(rig){
  if(rig._strumLocal) return rig._strumLocal;
  const palm = [0,-1,0];
  const J = [];
  const radial = norm(sub(rig.rest[jointName(1,1)], rig.rest[jointName(2,1)]));   // 人差し指側
  for(let f=1; f<=4; f++){
    const M = rig.rest[jointName(f,0)], K = rig.rest[jointName(f,1)], T = rig.rest[jointName(f,4)];
    let d0 = norm(sub(T,K));
    // 指を中指の方へ少し寄せる
    const sp = CFG.splay[f]*DEG;
    d0 = norm(add(mul(d0, Math.cos(sp)), mul(radial, -Math.sin(sp))));
    const n1 = norm(sub(palm, mul(d0, dot(d0,palm))));
    const L = rig.lengths[f], c = CFG.curl[f];
    const pts = [K]; let a = 0, p = K;
    for(let i=0;i<3;i++){ a += c[i]*DEG; p = add(p, add(mul(d0, Math.cos(a)*L[i]), mul(n1, Math.sin(a)*L[i]))); pts.push(p); }
    const axis = norm(cross(d0, n1));
    const Bm = rig.restBasis[jointName(f,0)];
    J.push({name: jointName(f,0), pos: M, fwd: norm(sub(K,M)), dorsal: Bm[1]});
    for(let i=0;i<4;i++){
      const fwd = norm(sub(pts[Math.min(i+1,3)], pts[Math.min(i,2)]));
      J.push({name: jointName(f,i+1), pos: pts[i], fwd, dorsal: cross(fwd, axis), f, i: i+1});
    }
  }
  // 親指：腹を人差し指の第一関節の横（親指側・少し手のひら側）に当てる
  rig.thumbModel ||= makeThumbModel(THUMB_JOINTS.map(n=>rig.rest[n]), THUMB_JOINTS.map(n=>rig.restBasis[n]), palm, rig.rest[jointName(1,1)]);
  const iP = J.find(j=>j.name===jointName(1,2)).pos, iD = J.find(j=>j.name===jointName(1,3)).pos;
  const thTarget = add(add(mul(add(iP,iD),0.5), mul(radial, 9)), mul(palm, 2));
  const th = solveThumbTo(rig.thumbModel, thTarget); if(typeof window!=='undefined') window.__rthumb = {ang: th.ang, cost: th.cost};
  for(let i=0;i<4;i++){
    const B = rig.thumbModel.restBasis[i], R = th.Rs[i];
    const mv = v => [dot(R[0],v), dot(R[1],v), dot(R[2],v)];
    J.push({name: THUMB_JOINTS[i], pos: th.pts[i], fwd: mv(mul(B[2],-1)), dorsal: mv(B[1])});
  }
  // 人差し指の爪のあたり（弦に当たる点）
  // 弦に当たるのは、丸めた人差し指の第一関節〜爪の背中側
  const iDj = J.find(j=>j.name===jointName(1,3)), iTj = J.find(j=>j.name===jointName(1,4));
  const hit = add(mul(add(iDj.pos, iTj.pos), 0.5), mul(norm(iDj.dorsal), 7));
  rig._strumLocal = {J, hit};
  return rig._strumLocal;
}

/* st = {theta: 振りの角度（＋がダウン方向）, lift: 弦から浮かせる量 mm} */
export function rightHandPose(rig, st){
  const {J, hit} = localHand(rig);
  // 手の向きは前腕の向きから決める：前腕の延長線から、手のひら側へ wristFlex 度だけ曲げる
  const fa0 = mul(norm(CFG.elbow), -1);                         // ひじ→手首
  const P0 = norm(sub(CFG.palm, mul(fa0, dot(CFG.palm, fa0))));  // 前腕に直交する「手のひら側」
  const a = CFG.wristFlex*DEG;
  let F = norm(add(mul(fa0, Math.cos(a)), mul(P0, Math.sin(a))));
  let N = norm(sub(P0, mul(F, dot(P0, F))));
  const U = mul(N,-1), Z = mul(F,-1), Y = U, X = cross(Y,Z);
  const toW = v => add(add(mul(X,v[0]), mul(Y,v[1])), mul(Z,v[2]));
  // θ=0 のとき人差し指の爪が弦のまん中を通るように手首の位置を決める
  const target = [STRUM_X, 0, stringZ(STRUM_X) + 0.4];
  const W = sub(target, toW(hit));
  // 振り子のように回しつつ、指先は弦の面に沿って動くように高さを補正する
  // （ひじを支点にした前腕の回転＋手首のスナップ。弦を越えたら少し浮く）
  const pivot = add(target, [0, 0, CFG.pivotUp]);
  const ax = [1, 0, 0];
  const th = st.theta;
  const rotP = p => add(pivot, R3(ax, th, sub(p, pivot)));
  const hitR = rotP(add(W, toW(hit)));
  const off = [0, 0, (stringZ(STRUM_X) + 0.4 - hitR[2]) + st.lift + Math.max(0, Math.abs(hitR[1]) - 17)*0.35];
  const place = p => add(rotP(p), off);
  const dir = v => R3(ax, th, v);
  const out = [];
  const Wp = place(W);
  out.push({name:'wrist', pos: Wp, fwd: dir(F), dorsal: dir(U)});
  // 見えている腕は手首の少し先までなので、前腕は手首からそのまま伸ばす
  // （手首で強く折ると、短い腕の皮膚がねじれてギザギザに見えるため）。少しだけ前腕の向きに寄せる
  const fa = norm(add(mul(dir(F), 0.8), mul(dir(fa0), 0.2)));
  out.push({name:'forearm', pos: Wp, fwd: fa, dorsal: sub(dir(U), mul(fa, dot(dir(U),fa)))});
  for(const j of J) out.push({name: j.name, pos: place(add(W, toW(j.pos))), fwd: norm(dir(toW(j.fwd))), dorsal: norm(dir(toW(j.dorsal)))});
  return {joints: out, tip: place(add(W, toW(hit)))};
}

/* ---------- ストロークのパターン（8分音符8つで1小節） ---------- */
export const PATTERNS = [
  {name:'ダウン4つ',             p:'D-D-D-D-', tip:'1拍に1回、上から下へ。まずはここから'},
  {name:'8ビート（ダウン・アップ）', p:'DUDUDUDU', tip:'下・上・下・上。手は止めずに振り子のように'},
  {name:'カリプソ（ハワイアン定番）', p:'D-DU-UDU', tip:'「ダン・ダダ・ンダ・ダダ」。空振りのところも手は振り続けます'},
  {name:'ゆったりバラード',         p:'D--UD-DU', tip:'1拍目と3拍目をしっかり。ゆっくりのテンポで'},
];

// 時刻 → 右手の振り（8分音符の位置 phase を渡す）
export function strumState(phase, pattern){
  const theta = STRUM_AMP * Math.sin(Math.PI*phase);
  // いちばん近い「弦を通るタイミング」が空振りなら、手を浮かせる
  const k = Math.round(phase), d = phase - k;
  const ghost = pattern[((k%8)+8)%8] === '-';
  const bump = Math.abs(d) < 0.5 ? Math.pow(Math.cos(Math.PI*d), 2) : 0;
  return {theta, lift: ghost ? 13*bump : 0};
}
