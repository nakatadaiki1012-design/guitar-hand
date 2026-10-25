/* =========================================================
   右手の指弾き（フィンガーピッキング）
   ・構え：前腕はボディの縁の上を表板に沿って寝かせて来て、手首で軽く曲げ、手は弦の上から1弦側（下）へ垂らす（クラシックギターの構え）
   ・親指（p）：6・5・4弦のベース。弦のすぐ6弦側に添えておき、1弦側（床の方）へ押して弾く
   ・人差し指（i）＝3弦、中指（m）＝2弦、薬指（a）＝1弦 が基本。弦の1弦側に添えておき、手のひらの方（6弦側）へはじく
     小指は弾かず、薬指の後ろについていく
   ・st = {mode:'finger', thumbS: 親指の弦（6弦=0〜）, strings:{1:弦,2:弦,3:弦}, pluck:{t:u, 1:u, 2:u, 3:u}, lift:mm}
       u：弾く動きの進み具合（0＝弦に添えている、0.5＝弦を通る、1＝弾き終わり）
   ========================================================= */
import { strY, stringZ, STRUM_X, add, sub, mul, dot, cross, norm, vlen, DEG } from './geom.js';
import { jointName, THUMB_JOINTS } from './handrig.js';
import { makeThumbModel, solveThumbTo } from './thumb.js';

const CFG = {
  // 実際の構え（クラシックギター）：前腕はボディの上の縁（6弦側）を越えて来て、手首は弦の6弦側の上、表板から浮かせる。
  // 手は下（1弦側）へ垂れ、指は弦の上から下りて、手のひら側（6弦側・上）へ曲げて弾く。親指は指よりネック側に出て、ベース弦を下へ押して弾く
  // 前腕の向きを先に決め、手首で手のひら側へ曲げて手の向きを作る（前腕がギターの正面から突き出さないように）
  elbow: [0.60, -0.75, -0.10],   // 手首→ひじ：前腕はボディのおしり側・6弦側の縁の上を、表板に沿って寝かせて来る
  palmHint: [0.0, 0.3, -1.0],    // 手のひらはだいたい表板の方
  wristFlex: 15,                 // 手首を手のひら側へ曲げる角度（軽く）
  wristRoll: -20,                // 前腕のひねり（度）：親指側を少し起こす
  fan: {1: 6, 2: 0, 3: -6},      // 指先の前後の位置（mm）：人差し指はブリッジ寄り、薬指はネック寄り
  thumbX: -22,                   // 親指の先は、ほかの指より 22mm ネック寄り（指の前に出る）
  pad: 8,                        // 指先の関節から、弦に当たる指の腹の点まで（mm）
  thumbShift: 5,                 // 親指が弦を1本移るごとに、手ごと動く量（mm）
  knuckleBack: 25, knuckleUp: 75,// 中指のつけ根は、中指の指先の「構えの位置」から、手首側へ24mm・表板から離れる方へ68mm（指は付け根40°・第二関節50°ほどの自然な曲げ）
  splay: {1: 2, 2: 0, 3: -2, 4: -4},   // 指はほぼそろえて、平行に下ろす
  // 弾く動き：弦に添えた位置（rest）→ 弾き終わりの位置（through）。y：1弦側が＋、z：客席側が＋
  //   指（i・m・a）：弦の1弦側に添え、手のひらの方（6弦側・上）へ弦をはじいて、少し浮く
  //   親指（p）　　：弦の6弦側に添え、下（1弦側）へ押して、少し浮く
  rest:    {dy:  2.5, dz: 2.2},
  through: {dy: -7.0, dz: 8.0},
  thumbRest:    {dy: -3.0, dz: 3.5},
  thumbThrough: {dy:  9.0, dz: 7.0},
};
if(typeof window !== 'undefined') window.__fpCfg = CFG;    // 検証用（構えの数値を外から変えて試す）
const R3 = (axis, a, v) => { const k = norm(axis), c = Math.cos(a), s = Math.sin(a);
  return add(add(mul(v,c), mul(cross(k,v),s)), mul(k, dot(k,v)*(1-c))); };
const ease = u => u <= 0 ? 0 : u >= 1 ? 1 : u*u*(3-2*u);
const strYf = (s, x) => { const a = Math.floor(s), b = Math.min(5, a + 1), f = s - a; return strY(a, x)*(1-f) + strY(b, x)*f; };

/* 1本の指：つけ根 K から、指の腹の点を T に。第二関節の曲げを二分探索し、第一関節はその0.7倍 */
function solveFinger(L, K, T, d0, n1){
  const Lp = [L[0], L[1], L[2] + CFG.pad];
  const d = sub(T, K), b = dot(d, n1); let e = sub(d, mul(n1, b)); const a = vlen(e); e = a > 1e-6 ? mul(e, 1/a) : d0;
  const tgt = Math.hypot(a, b), tAng = Math.atan2(b, a);
  const chain = (th, p) => { let ang = th, x = 0, y = 0; const o = [[0,0]];
    [[Lp[0],0],[Lp[1],p],[Lp[2],0.7*p]].forEach(([l,da])=>{ ang += da; x += l*Math.cos(ang); y += l*Math.sin(ang); o.push([x,y]); }); return o; };
  const lenAt = p => { const q = chain(0, p)[3]; return Math.hypot(q[0], q[1]); };
  let p;
  const maxP = 110*DEG;
  if(tgt >= lenAt(0)) p = 0; else if(tgt <= lenAt(maxP)) p = maxP;
  else { let lo = 0, hi = maxP; for(let i=0;i<24;i++){ const m = (lo+hi)/2; if(lenAt(m) > tgt) lo = m; else hi = m; } p = (lo+hi)/2; }
  const q = chain(0, p)[3];
  const th = tAng - Math.atan2(q[1], q[0]);
  const pts = chain(th, p).map(([u,v]) => add(K, add(mul(e,u), mul(n1,v))));
  const tip = add(pts[2], mul(norm(sub(pts[3], pts[2])), L[2]));          // 指の腹の点 → モデルの指先の関節
  return [pts[0], pts[1], pts[2], tip];
}

export function fingerPose(rig, st){
  const X0 = STRUM_X;
  const fa0 = mul(norm(CFG.elbow), -1);                                         // ひじ→手首
  const P0 = norm(sub(CFG.palmHint, mul(fa0, dot(CFG.palmHint, fa0))));
  const fl = CFG.wristFlex*DEG;
  const F = norm(add(mul(fa0, Math.cos(fl)), mul(P0, Math.sin(fl))));        // 手首→指のつけ根
  let N = norm(sub(P0, mul(F, dot(P0, F))));
  N = R3(F, CFG.wristRoll*DEG, N);
  const U = mul(N, -1), Z = mul(F, -1), Y = U, X = cross(Y, Z);
  const toW = v => add(add(mul(X, v[0]), mul(Y, v[1])), mul(Z, v[2]));
  const toL = v => [dot(X, v), dot(Y, v), dot(Z, v)];
  const rest = rig.rest;
  const strings = st.strings || {1:3, 2:4, 3:5};
  const pluck = st.pluck || {};
  // 指先の目標（弦に添えた位置〜弾き終わり）
  const tipTarget = (f, s) => {
    const u = ease(pluck[f] || 0), x = X0 + CFG.fan[f], y0 = strYf(s, x), z0 = stringZ(x);
    return [x, y0 + CFG.rest.dy + (CFG.through.dy - CFG.rest.dy)*u, z0 + CFG.rest.dz + (CFG.through.dz - CFG.rest.dz)*u*u];
  };
  // 手首の位置：中指のつけ根が、中指の構えの位置から決まった所に来るように
  const Tm = (()=>{ const x = X0 + CFG.fan[2]; return [x, strYf(strings[2], x) + CFG.rest.dy, stringZ(x) + CFG.rest.dz]; })();   // 中指の構えの位置（弾く動きでは手は動かさない）
  const Km = add(add(Tm, mul(F, -CFG.knuckleBack)), mul(N, -CFG.knuckleUp));
  const tsh = ((st.thumbS ?? 1) - 1)*CFG.thumbShift;                                    // 親指が弦を移る分、手ごと少しついていく（6弦なら上へ、4弦なら下へ）
  const W = add(sub(Km, toW(rest[jointName(2,1)])), [0, tsh, st.lift || 0]);
  const out = [];
  out.push({name:'wrist', pos: W, fwd: F, dorsal: U});
  const Ua = R3(fa0, CFG.wristRoll*DEG, mul(P0, -1));                       // 前腕の甲側
  out.push({name:'forearm', pos: W, fwd: fa0, dorsal: norm(sub(Ua, mul(fa0, dot(Ua, fa0))))});
  const radial = norm(toW(sub(rest[jointName(1,1)], rest[jointName(2,1)])));
  const tips = {}, errs = {}, angs = {};
  for(let f=1; f<=4; f++){
    const M = add(W, toW(rest[jointName(f,0)])), K = add(W, toW(rest[jointName(f,1)]));
    let d0 = norm(toW(sub(rest[jointName(f,4)], rest[jointName(f,1)])));
    const sp = CFG.splay[f]*DEG; d0 = norm(add(mul(d0, Math.cos(sp)), mul(radial, -Math.sin(sp))));
    const n1 = norm(sub(N, mul(d0, dot(d0, N))));
    const L = rig.lengths[f];
    // 小指は弾かない：薬指のすぐ後ろ（1弦より外・少し浮かせた所）に、薬指と同じように曲げてついていく
    const T4 = (()=>{ const x = X0 + CFG.fan[3] - 7; return [x, strYf(5, x) + 13, stringZ(x) + 11]; })();
    const pts = solveFinger(L, K, f === 4 ? T4 : tipTarget(f, strings[f]), d0, n1);
    const axis = norm(cross(d0, n1));
    out.push({name: jointName(f,0), pos: M, fwd: norm(sub(K, M)), dorsal: U});
    for(let i=0;i<4;i++){
      const fwd = norm(sub(pts[Math.min(i+1,3)], pts[Math.min(i,2)]));
      out.push({name: jointName(f,i+1), pos: pts[i], fwd, dorsal: norm(cross(fwd, axis))});
    }
    tips[f] = add(pts[2], mul(norm(sub(pts[3], pts[2])), L[2] + CFG.pad));
    if(f < 4) errs[f] = vlen(sub(tips[f], tipTarget(f, strings[f])));
    { const v1 = norm(sub(pts[1], pts[0])), v2 = norm(sub(pts[2], pts[1]));
      angs[f] = {mcp: Math.atan2(dot(v1, n1), dot(v1, d0))/DEG, pip: Math.acos(Math.max(-1, Math.min(1, dot(v1, v2))))/DEG}; }
  }
  // 親指：ベースの弦の6弦側に添え、弾く時は1弦側へ
  const mv = (R, v) => [dot(R[0],v), dot(R[1],v), dot(R[2],v)];
  rig.thumbModelFP ||= makeThumbModel(THUMB_JOINTS.map(n=>rest[n]), THUMB_JOINTS.map(n=>rig.restBasis[n]), [0,-1,0], rest[jointName(1,1)]);
  const ut = ease(pluck.t || 0), ts = st.thumbS ?? 1, tx = X0 + CFG.thumbX;
  const tT = [tx, strYf(ts, tx) + CFG.thumbRest.dy + (CFG.thumbThrough.dy - CFG.thumbRest.dy)*ut, stringZ(tx) + CFG.thumbRest.dz + (CFG.thumbThrough.dz - CFG.thumbRest.dz)*ut*ut];
  const tl = toL(sub(tT, W));
  const key = tl.map(v => Math.round(v/1.5)).join(',');
  rig._fpThumb ||= new Map();
  let th = rig._fpThumb.get(key);
  if(!th){ th = solveThumbTo(rig.thumbModelFP, tl); if(rig._fpThumb.size > 400) rig._fpThumb.clear(); rig._fpThumb.set(key, th); }
  for(let i=0;i<4;i++){
    const B = rig.thumbModelFP.restBasis[i], R = th.Rs[i];
    out.push({name: THUMB_JOINTS[i], pos: add(W, toW(th.pts[i])), fwd: norm(toW(mv(R, mul(B[2],-1)))), dorsal: norm(toW(mv(R, B[1])))});
  }
  // 親指の腹の点（thumb.js と同じ：先の関節から 1mm 先、爪と反対側へ 6mm）
  const nailL = mv(th.Rs[2], rig.thumbModelFP.restBasis[2][1]), fwdL = norm(sub(th.pts[3], th.pts[2]));
  tips.t = add(W, toW(add(add(th.pts[3], mul(fwdL, 1)), mul(nailL, -6))));
  errs.t = vlen(sub(tips.t, tT));
  return {joints: out, tip: tips[1], tips, errs, angs, thAng: th.ang, wrist: W, arm: fa0, pick: null};
}

/* ---------- タブ譜 → 指の動き ----------
   音ごとに、どの指で弾くかを決める：いちばん太い弦が6〜4弦なら親指。3弦＝人差し指、2弦＝中指、1弦＝薬指。
   ふさがっていれば隣の指。弾く動きは音の 35ms 前に始まり、音の時刻に弦を通り、50ms 後に弾き終わって、180ms かけて弦の所へ戻る */
export function assignDigits(notes){
  const out = {}; const used = new Set();
  const ss = notes.map(n=>n.s).sort((a,b)=>a-b);
  for(const s of ss){
    let d;
    if(s <= 2 && !used.has('t')) d = 't';
    else { const pref = s <= 3 ? 1 : s === 4 ? 2 : 3; d = [pref, pref+1, pref+2, pref-1, pref-2].find(k => k >= 1 && k <= 3 && !used.has(k)); if(d == null) d = !used.has('t') ? 't' : null; }
    if(d == null) continue;
    used.add(d); out[d] = s;
  }
  return out;
}
export function fingerPlanRight(events, bs){
  const digits = {t:[], 1:[], 2:[], 3:[]};
  for(const e of events){ const a = assignDigits(e.notes); for(const d in a) digits[d].push({t: e.t*bs, s: a[d]}); }
  return digits;
}
const PRE = 0.035, POST = 0.05, BACK = 0.18;
export function fingerStateAt(plan, t){
  const st = {mode:'finger', strings:{1:3, 2:4, 3:5}, thumbS: 1, pluck:{}, lift: 0};
  for(const d of ['t', 1, 2, 3]){
    const list = plan[d]; if(!list.length) continue;
    let i = -1; for(let k=0;k<list.length;k++){ if(list[k].t - PRE <= t) i = k; else break; }
    const prev = list[i], next = list[i+1];
    let u = 0, s;
    if(!prev){ s = next.s; }
    else {
      const t0 = prev.t - PRE, t1 = prev.t + POST;
      if(t < t1) u = (t - t0)/(t1 - t0);
      else u = Math.max(0, 1 - (t - t1)/BACK);
      s = prev.s;
      if(next && t >= t1 && next.s !== prev.s){                                // 次の弦へ移る（弾き終わってから次の音までの間に、なめらかに）
        const a = t1, b = Math.max(a + 0.08, next.t - PRE); const w = Math.min(1, Math.max(0, (t - a)/(b - a)));
        s = prev.s + (next.s - prev.s)*ease(w);
      }
    }
    if(d === 't') st.thumbS = s; else st.strings[d] = s;
    st.pluck[d] = u;
  }
  return st;
}
