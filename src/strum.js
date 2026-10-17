/* =========================================================
   右手のストローク
   ・手の形：ピックを軽く持つような形。人差し指は軽く曲げるだけ（伸ばし気味）で、爪の背中側で弦をこする。中指〜小指はその後ろに軽く握り込む。
             親指の腹は人差し指の第一関節の横にそっと当てる
   ・腕の向き：前腕はウクレレの尾側（ボディのおしり側）から来て、ボディの上の縁にのせる
   ・動き　：腕ごとではなく、手首のスナップと前腕の回転（回内・回外）が中心。腕は少しだけついてくる
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
  curl:  {1:[26,56,48], 2:[66,95,55], 3:[72,98,55], 4:[76,98,55]},  // 指の曲げ（付け根・第二・第一関節）
  splay: {1:6, 2:0, 3:-7, 4:-15},            // 指を軽く寄せる（度）
  pivotUp: 120,                              // 腕で振る時の中心：弦から客席側へ何mmか
  rollMix: 0.5,                              // 回す軸：0=手首の横振り … 1=前腕のひねり
  armFollow: 0.3,                            // 弦の上の動きのうち、腕ごと動く割合（残りは手首のスナップ）
  elbow: [0.55, -0.50, -0.67],               // 手首→ひじの向き：前腕はウクレレの尾側から、ボディの上の縁にのせて斜めに来る
};

const R3 = (axis, a, v) => { const k = norm(axis), c = Math.cos(a), s = Math.sin(a);
  return add(add(mul(v,c), mul(cross(k,v),s)), mul(k, dot(k,v)*(1-c))); };

// 手首を原点にした「手の中の座標」での関節（1回だけ計算）
// flick：指のしなり（度）。＋で指が伸びる（ダウンで爪が先に当たる）、－で指が丸まる（アップで腹が当たる）
function localHand(rig, flick=0){
  flick = Math.round(flick/3)*3;                             // 3度きざみでキャッシュ
  rig._strumCache ||= new Map();
  if(rig._strumCache.has(flick)) return rig._strumCache.get(flick);
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
    const L = rig.lengths[f], fl = flick * [0,1,0.55,0.4,0.3][f];
    const c = CFG.curl[f].map((v,i)=>v - fl*[0.5,0.3,0.2][i]);
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
  const th = solveThumbTo(rig.thumbModel, thTarget);
  for(let i=0;i<4;i++){
    const B = rig.thumbModel.restBasis[i], R = th.Rs[i];
    const mv = v => [dot(R[0],v), dot(R[1],v), dot(R[2],v)];
    J.push({name: THUMB_JOINTS[i], pos: th.pts[i], fwd: mv(mul(B[2],-1)), dorsal: mv(B[1])});
  }
  // 人差し指の爪のあたり（弦に当たる点）
  // 弦に当たるのは、丸めた人差し指の第一関節〜爪の背中側
  const iDj = J.find(j=>j.name===jointName(1,3)), iTj = J.find(j=>j.name===jointName(1,4));
  const hit = add(mul(add(iDj.pos, iTj.pos), 0.5), mul(norm(iDj.dorsal), 7));
  const res = {J, hit};
  rig._strumCache.set(flick, res);
  return res;
}

/* st = {theta: 振りの角度（＋がダウン方向）, lift: 弦から浮かせる量 mm} */
export function rightHandPose(rig, st){
  const {J, hit} = localHand(rig, st.flick || 0);
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
  // 手首のしなり（flex：手のひら側へ）と前腕のひねり（roll）を、手首を中心に加える
  const flexA = (st.wrist || 0)*DEG, rollA = (st.roll || 0)*DEG;
  const bend = v => R3(F, rollA, R3(X, flexA, v));
  const toWb = v => bend(toW(v));
  const W = sub(target, toWb(hit));
  // 振り子のように回しつつ、指先は弦の面に沿って動くように高さを補正する
  // （ひじを支点にした前腕の回転＋手首のスナップ。弦を越えたら少し浮く）
  // 回す中心は手首の近く（腕ごと振るのではなく、手首のスナップと前腕の回転で弾く）。
  // 中心が指先に近づくぶん、同じ幅を弦の上で動くように角度を大きくする
  const pivot = W;
  // 回す軸：前腕のひねり（前腕の向き）と手首の横振り（ネックの向き）の中間
  const ax = norm(add(mul([1,0,0], 1-CFG.rollMix), mul(fa0, -CFG.rollMix)));
  const hv = sub(target, pivot), rHit = vlen(sub(hv, mul(ax, dot(hv, ax))));
  const reach = st.theta * (CFG.pivotUp - 4);                   // 弦の上で指先が動く幅（mm）
  const follow = reach * CFG.armFollow;                          // 腕ごと少しついてくる分
  const th = (reach - follow) / rHit;                            // 残りは手首のスナップで
  const rotP = p => add(add(pivot, R3(ax, th, sub(p, pivot))), [0, follow, 0]);
  const hitR = rotP(add(W, toWb(hit)));
  const off = [0, 0, (stringZ(STRUM_X) + 0.4 - hitR[2]) + st.lift + Math.max(0, Math.abs(hitR[1]) - 17)*0.35];
  const place = p => add(rotP(p), off);
  const dir = v => R3(ax, th, v);
  const out = [];
  const Wp = place(W);
  out.push({name:'wrist', pos: Wp, fwd: dir(bend(F)), dorsal: dir(bend(U))});
  // 見えている腕は手首の少し先までなので、前腕は手首からそのまま伸ばす
  // （手首で強く折ると、短い腕の皮膚がねじれてギザギザに見えるため）。少しだけ前腕の向きに寄せる
  // 前腕はあまり動かない（手首から先が主に動く）
  const dirArm = v => R3(ax, th*0.15, v);
  const fa = norm(add(mul(dirArm(F), 0.8), mul(dirArm(fa0), 0.2)));
  const Ur = dirArm(R3(F, rollA*0.8, U));                                // 前腕の回転（回内・回外）なので前腕もひねる
  out.push({name:'forearm', pos: Wp, fwd: fa, dorsal: sub(Ur, mul(fa, dot(Ur,fa)))});
  for(const j of J) out.push({name: j.name, pos: place(add(W, toWb(j.pos))), fwd: norm(dir(toWb(j.fwd))), dorsal: norm(dir(toWb(j.dorsal)))});
  return {joints: out, tip: place(add(W, toWb(hit)))};
}

/* ---------- ストロークのパターン（8分音符8つで1小節） ---------- */
export const PATTERNS = [
  {name:'ダウン4つ',             p:'D-D-D-D-', tip:'1拍に1回、上から下へ。まずはここから'},
  {name:'8ビート（ダウン・アップ）', p:'DUDUDUDU', tip:'下・上・下・上。手は止めずに振り子のように'},
  {name:'カリプソ（ハワイアン定番）', p:'D-DU-UDU', tip:'「ダン・ダダ・ンダ・ダダ」。空振りのところも手は振り続けます'},
  {name:'ゆったりバラード',         p:'D--UD-DU', tip:'1拍目と3拍目をしっかり。ゆっくりのテンポで'},
];

/* ---------- 人間らしい振り方 ----------
   研究メモ（ギターのストロークの観察・動作解析の報告より）
   ・腕だけで振らない：ひじを支点にした腕の振り＋前腕のひねり（回内・回外）＋手首のしなりの組み合わせ
   ・手首は腕より少し遅れてついてくる（ムチのように、腕が先・手先があと）
   ・弦を通るところがいちばん速く、上と下の折り返しはゆっくり
   ・ダウンは全部の弦をしっかり、アップは1〜3弦だけ軽く（振り幅が小さい）
   ・指先がしなる：ダウンでは指が少し伸びて爪が先に当たり、アップでは丸まって指の腹が当たる
   ・1拍目は少し大きく（アクセント）、空振りは小さく浮かせる
   ・毎回まったく同じではない：振り幅・タイミングがほんの少しずつばらつく */
const hash = k => { const x = Math.sin(k*127.1 + 311.7)*43758.5453; return x - Math.floor(x); };
function strokeAmp(k, pattern){
  const n = pattern.length, slot = ((k%n)+n)%n;
  const ghost = pattern[slot] === '-', up = (k & 1) === 1;
  let a = 1;
  if(slot === 0) a *= 1.12;                          // 1拍目のアクセント
  else if(slot % 2 === 0) a *= 1.0;
  if(up) a *= 0.82;                                  // アップは小さめ
  if(ghost) a *= 0.72;                               // 空振りはさらに小さく
  a *= 1 + (hash(k) - 0.5)*0.12;                     // 少しのばらつき
  return a;
}
const smooth = t => t*t*(3-2*t);

// 時刻 → 右手の振り（8分音符の位置 phase を渡す）
export function strumState(phase, pattern){
  const k = Math.floor(phase), f = phase - k;
  // その半周期の振り幅（となりの振りとなめらかにつなぐ）
  const A = STRUM_AMP * (strokeAmp(k, pattern) + (strokeAmp(k+1, pattern) - strokeAmp(k, pattern))*smooth(f));
  const theta = A * Math.sin(Math.PI*phase);
  // 手首は腕より遅れてしなる（位相を少し遅らせる）
  const lag = 0.14;
  const wrist = -16 * (A/STRUM_AMP) * Math.sin(Math.PI*(phase - lag));
  // 前腕のひねり：ダウンで手の甲が少し上を向くように
  const roll = 18 * (A/STRUM_AMP) * Math.sin(Math.PI*(phase - lag*0.5));
  // 指のしなり：動く向き（速度）に合わせて。弦を通る少し前から
  const v = Math.cos(Math.PI*(phase + 0.06));               // ＋で下向き（ダウン）に動いている
  const flick = v > 0 ? 12*v : 8*v;
  // 空振りは手を浮かせる
  const kk = Math.round(phase), d = phase - kk;
  const ghost = pattern[((kk%pattern.length)+pattern.length)%pattern.length] === '-';
  const bump = Math.abs(d) < 0.5 ? Math.pow(Math.cos(Math.PI*d), 2) : 0;
  return {theta, lift: ghost ? 13*bump : 0, wrist, roll, flick};
}

// 弾いていない時：力を抜いて、ゆっくり呼吸するように少しだけ揺れる
export function idleState(t){
  return {theta: -STRUM_AMP*0.9 + 0.025*Math.sin(t*1.1), lift: 7 + 1.5*Math.sin(t*0.7+1), wrist: 4 + 2*Math.sin(t*0.9), roll: 0, flick: -4};
}
