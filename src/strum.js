/* =========================================================
   右手のストローク
   ・手の形：ピックを持つ。人差し指を軽く曲げ、その指先の節の横と親指の先の腹でピックをつまむ。中指〜小指はその後ろに軽く握り込む。
             ピックの先（とがった所）が指から7mmほど出て、そこで弦を弾く
   ・腕の向き：前腕はギターの尾側（ボディのおしり側）から、ボディの上の方をほぼ水平に横切って来る（ひじは体の横で約90°）
   ・動き　：腕は止めたまま、手の甲を軸にして指先側を回して弾く（手の甲はあまり動かない）
             ダウン（6弦→1弦）もアップ（1弦→6弦）も、ピックの先で弦を弾く
   ・弾かない拍（空ピッキング）でも手は止めず、弦から少し浮かせて振り続ける
   ========================================================= */
import { strY, stringZ, STRUM_X, add, sub, mul, dot, cross, norm, vlen, DEG } from './geom.js';
import { jointName, THUMB_JOINTS } from './handrig.js';
import { makeThumbModel, solveThumbTo } from './thumb.js';

export { STRUM_X };                          // 弾く場所（geom.js：アコギはサウンドホールの上、エレキはピックアップの間）
export const PICK_TIP = 14;
const PICK_DEPTH = 1.0;                      // ピックの先が弦の下面より何mm深く通るか                  // ピックの中心から先までの長さ（mm）
export const STRUM_AMP = 0.42;               // 振りの大きさ（ラジアン）：6本の弦を越えるくらい

const CFG = {
  wristFlex: 32,                             // 手首は手のひら側へ軽く曲げるだけ（横には曲げない）
  palm: [0, -0.15, -1],                      // 手のひらはボディの方を向く（手の甲は客席側）
  curl:  {1:[26,56,48], 2:[66,95,55], 3:[72,98,55], 4:[76,98,55]},  // 指の曲げ（付け根・第二・第一関節）
  splay: {1:6, 2:0, 3:-7, 4:-15},            // 指を軽く寄せる（度）
  pivotUp: 120,                              // 腕で振る時の中心：弦から客席側へ何mmか
  rollBias: -12,                             // 構えの時から、前腕を小指側へ少しひねっておく（度）
  armFollow: 0,                              // 弦の上の動きのうち、腕ごと動く割合（0：腕は止めて、手の甲を軸に回して弾く）
  backDepth: 14,                             // 回す軸：手の甲の表面（骨から甲側へ何mmか）
  elbow: [0.84, -0.30, -0.45],               // 手首→ひじの向き：前腕はギターの尾側から、ボディの上の方をほぼ水平に横切って来る（ひじは体の横）
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
  // ピックは指先でつまむ：人差し指のいちばん先の節（第一関節〜指先）の横と、親指の先の腹ではさむ
  const iT0 = J.find(j=>j.name===jointName(1,4)).pos;
  const grip = add(mul(iD, 0.4), mul(iT0, 0.6));
  const thTarget = add(add(grip, mul(radial, 9)), mul(palm, 1));
  const th = solveThumbTo(rig.thumbModel, thTarget);
  for(let i=0;i<4;i++){
    const B = rig.thumbModel.restBasis[i], R = th.Rs[i];
    const mv = v => [dot(R[0],v), dot(R[1],v), dot(R[2],v)];
    J.push({name: THUMB_JOINTS[i], pos: th.pts[i], fwd: mv(mul(B[2],-1)), dorsal: mv(B[1])});
  }
  // ピック：親指の腹と、人差し指の第一関節の横ではさむ。面は親指の方を向き、先は手のひら側（弦の方）へ出る
  const iDj = J.find(j=>j.name===jointName(1,3)), iTj = J.find(j=>j.name===jointName(1,4));
  const pickN = radial;
  const pd = add(norm(sub(iTj.pos, iDj.pos)), mul(palm, 1.2));
  const pickX = norm(sub(pd, mul(pickN, dot(pd, pickN))));
  const pickC = add(add(grip, mul(radial, 7.6)), mul(pickX, 4));
  const hit = add(pickC, mul(pickX, PICK_TIP));
  // 手の甲のまん中（中指の骨のまん中あたりの、甲の表面）… ここを軸にして指先側を回す
  const m0 = rig.rest[jointName(2,0)], m1 = rig.rest[jointName(2,1)];
  const back = add(mul(add(m0, m1), 0.5), mul(palm, -CFG.backDepth));
  const res = {J, hit, back, pick:{c: pickC, x: pickX, n: pickN}};
  rig._strumCache.set(flick, res);
  return res;
}

/* st = {theta: 振りの角度（＋がダウン方向）, lift: 弦から浮かせる量 mm} */
export function rightHandPose(rig, st){
  const {J, hit, back, pick} = localHand(rig, st.flick || 0);
  // 手の向きは前腕の向きから決める：前腕の延長線から、手のひら側へ wristFlex 度だけ曲げる
  const fa0 = mul(norm(CFG.elbow), -1);                         // ひじ→手首
  const P0 = norm(sub(CFG.palm, mul(fa0, dot(CFG.palm, fa0))));  // 前腕に直交する「手のひら側」
  const a = CFG.wristFlex*DEG;
  let F = norm(add(mul(fa0, Math.cos(a)), mul(P0, Math.sin(a))));
  let N = norm(sub(P0, mul(F, dot(P0, F))));
  const U = mul(N,-1), Z = mul(F,-1), Y = U, X = cross(Y,Z);
  const toW = v => add(add(mul(X,v[0]), mul(Y,v[1])), mul(Z,v[2]));
  // θ=0 のとき人差し指の爪が弦のまん中を通るように手首の位置を決める
  // ピックの先は弦の下側まで1mmほどくぐらせる（弦をしっかりはじく）
  const target = [STRUM_X, 0, stringZ(STRUM_X) - PICK_DEPTH];
  // 手首のしなり（flex：手のひら側へ）と前腕のひねり（roll）を、手首を中心に加える
  const flexA = (st.wrist || 0)*DEG, rollA = ((st.roll || 0) + CFG.rollBias)*DEG;
  const bend = v => R3(F, rollA, R3(X, flexA, v));
  const toWb = v => bend(toW(v));
  // 手の甲の位置は固定：しなり・ひねりを加えても甲はその場にあり、指先側だけが動く
  const bend0 = v => R3(F, CFG.rollBias*DEG, v), toW0 = v => bend0(toW(v));
  const B = add(sub(target, toW0(hit)), toW0(back));
  const W = sub(B, toWb(back));
  // 手の甲を軸に回して、指先が弦の上を動く（甲から指先までの距離に合わせて角度を決める）。
  // 指先は弦の面に沿って動くように高さを補正する（弦を越えたら少し浮く）
  const pivot = B;
  // 回す軸：甲から指先へ向かう線と、弦をまたぐ向き（y）の両方に直交する軸。
  // 甲からぶら下がった指先が、振り子のように弦をまたいで動く
  const hv = sub(target, pivot);
  const ax = norm(cross(hv, [0,1,0])), rHit = vlen(sub(hv, mul(ax, dot(hv, ax))));
  const reach = st.theta * (CFG.pivotUp - 4) * 0.72;            // 弦の上で指先が動く幅（mm）。残りは前腕のひねりで
  const follow = reach * CFG.armFollow;                          // 腕ごと少しついてくる分
  const th = (reach - follow) / rHit;
  const rotP = p => add(add(pivot, R3(ax, th, sub(p, pivot))), [0, follow, 0]);
  const hitR = rotP(add(W, toWb(hit)));
  // 弦の上（6本の幅）では指先を弦の面に合わせ、外側では弧を描いて自然に弦から離れる
  const span = Math.abs(strY(0, STRUM_X));
  const onStr = 1 - Math.min(1, Math.max(0, (Math.abs(hitR[1]) - span)/14));
  const zHit = stringZ(STRUM_X) - PICK_DEPTH;
  const corr = (zHit - hitR[2])*onStr;
  const off = [0, 0, corr + Math.max(0, zHit - hitR[2] - corr) + st.lift];   // 表板の方へは沈み込まない
  const place = p => add(rotP(p), off);
  const dir = v => R3(ax, th, v);
  const out = [];
  const Wp = place(W);
  out.push({name:'wrist', pos: Wp, fwd: dir(bend(F)), dorsal: dir(bend(U))});
  // 見えている腕は手首の少し先までなので、前腕は手首からそのまま伸ばす
  // （手首で強く折ると、短い腕の皮膚がねじれてギザギザに見えるため）。少しだけ前腕の向きに寄せる
  // 前腕はあまり動かない（手首から先が主に動く）
  const dirArm = v => v;                                          // 前腕は動かさない（手首から先だけが回る）
  const fa = norm(add(mul(dirArm(F), 0.8), mul(dirArm(fa0), 0.2)));
  const Ur = dirArm(R3(F, rollA*0.8, U));                                // 前腕の回転（回内・回外）なので前腕もひねる
  out.push({name:'forearm', pos: Wp, fwd: fa, dorsal: sub(Ur, mul(fa, dot(Ur,fa)))});
  for(const j of J) out.push({name: j.name, pos: place(add(W, toWb(j.pos))), fwd: norm(dir(toWb(j.fwd))), dorsal: norm(dir(toWb(j.dorsal)))});
  const pk = {pos: place(add(W, toWb(pick.c))), x: norm(dir(toWb(pick.x))), n: norm(dir(toWb(pick.n)))};
  return {joints: out, tip: place(add(W, toWb(hit))), pick: pk};
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
  // 前腕のひねり：甲を軸にした振りに合わせて、指先が同じ向きに動くようにひねる
  const roll = -12 * (A/STRUM_AMP) * Math.sin(Math.PI*(phase - lag*0.5));
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
