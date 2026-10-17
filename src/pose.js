/* =========================================================
   コード → 手の形（逆運動学）
   骨の長さ・指の付け根の位置は、手の3Dモデルの実寸をそのまま使う
   ========================================================= */
import { fretX, halfW, strY, FRET_TOP, NECK_BACK_Z, stringZ,
         add, sub, mul, dot, cross, vlen, norm, lerp, lerp3, DEG } from './geom.js';
import { jointName, THUMB_JOINTS } from './handrig.js';
import { makeThumbModel, solveThumb, neckSD } from './thumb.js';

// 指の太さ（半径・付け根〜指先）…弦に触れないかの判定用
const RAD = {1:[9.6,8.6,7.6,7.0], 2:[9.9,8.9,7.8,7.1], 3:[9.3,8.4,7.4,6.8], 4:[8.2,7.4,6.6,6.1]};
// 第一関節は第二関節の約0.75倍だけ曲がる（小指は約0.6倍）…計測研究の値
const COUPLE = {1:0.75, 2:0.75, 3:0.75, 4:0.6};
// モデルの「指先の関節(tip)」から実際の指先の皮膚までは約11mm（実測）。
// 計算では、指先の丸みの中心（tip関節から8.5mm先）を「指の腹の点」として、それを弦の上に置く
const PAD_EXT = 8.5, PAD_R = 4.8;

/* 手の向き：手のひらはネックの裏側にあり、親指はネックの裏の4弦(G)側に添える。
   指の付け根は1弦(A)側の縁の外にあり、指はそこからネックを回り込んで、斜めに弦を押さえる。
   前腕は体の側（ネックの裏・床側・ボディ側）から来て、手首で少し曲がる */
export const HAND_CFG = {
  F: [-0.30, 0.10, 1.0],  N: [0.10,-1, 0.25],     // ふつうのコード（F：手首→指の付け根 / N：手のひらの向き）
  Fb:[-0.25, 0.20, 1.0],  Nb:[0.10,-1, 0.10],     // セーハ
  yK: 36, zK: -12, yKb: 40, zKb: -10,             // 人差し指の付け根の位置
  arm: [0.45, 0.50, -0.74],                       // 手首→肘の向き
  tipTilt: 28,                                    // 指先は真上から何度くらい傾けて当てるか
};
function handFrame(barre, prm){
  const C = HAND_CFG;
  let F = norm(barre ? C.Fb : C.F);                                      // 手首→指の付け根
  let N = barre ? C.Nb : C.N;
  N = norm(sub(N, mul(F, dot(N,F))));                                   // 手のひらの向き（ネック側）
  // 手の向きの微調整（シミュレーションで決める）：ひねり・左右の傾き・ネックまわりの回転
  const R = (axis, a, v) => { const k = norm(axis), c = Math.cos(a), s = Math.sin(a);
    return add(add(mul(v,c), mul(cross(k,v),s)), mul(k, dot(k,v)*(1-c))); };
  if(prm){
    N = R(F, prm.roll*DEG, N);
    F = R(N, prm.yaw*DEG, F);
    F = R([1,0,0], prm.pitch*DEG, F); N = R([1,0,0], prm.pitch*DEG, N);
  }
  const U = mul(N,-1);                                                  // 手の甲の向き
  // 手首の関節の座標軸（WebXR：-Zが指先、+Yが手の甲）
  const Z = mul(F,-1), Y = U, X = cross(Y,Z);
  return {F, N, U, X, Y, Z};
}
const toWorld = (H, W, o) => add(W, add(add(mul(H.X,o[0]), mul(H.Y,o[1])), mul(H.Z,o[2])));

function chain2(L, th, p2, p3){
  let a=th, x=0, y=0; const out=[[0,0]];
  [[L[0],0],[L[1],p2],[L[2],p3]].forEach(([l,da])=>{ a+=da; x+=l*Math.cos(a); y+=l*Math.sin(a); out.push([x,y]); });
  return out;
}

/* 1本の指：第二関節の曲げ角を二分探索で決め、第一関節の連動比率をいくつか試して
   「指先が真上から当たる」「他の弦に触れない」「関節が無理な角度にならない」ものを選ぶ */
function solveFinger(f, Lbone, K, T, H, kind){
  const R = RAD[f];
  const L = [Lbone[0], Lbone[1], Lbone[2]+PAD_EXT];
  const d = sub(T,K), b = dot(d,H.N);
  let e = sub(d, mul(H.N,b)); const a = vlen(e); e = a>1e-6 ? mul(e,1/a) : H.F;
  const tgt = Math.hypot(a,b), tAng = Math.atan2(b,a);
  const toW = ([u,v]) => add(K, add(mul(e,u), mul(H.N,v)));
  const cs = kind==='press' ? [0.4,0.5,0.6,0.7,0.8,0.9,1.0] : [COUPLE[f]];
  let best = null;
  for(const c of cs){
    const lenAt = p=>{ const q=chain2(L,0,p,c*p)[3]; return Math.hypot(q[0],q[1]); };
    const maxP = 112*DEG; let p2;
    if(tgt >= lenAt(0)) p2 = 0;
    else if(tgt <= lenAt(maxP)) p2 = maxP;
    else { let lo=0, hi=maxP; for(let i=0;i<28;i++){ const m=(lo+hi)/2; if(lenAt(m)>tgt) lo=m; else hi=m; } p2=(lo+hi)/2; }
    const q = chain2(L,0,p2,c*p2)[3];
    const th = tAng - Math.atan2(q[1],q[0]);
    const pts = chain2(L,th,p2,c*p2).map(toW);
    let pen = 0;
    const dd = norm(sub(pts[3],pts[2]));
    if(kind==='press'){
      const ang = Math.acos(Math.min(1,Math.max(-1,-dd[2])))/DEG;      // 指先は少し斜めに立てて当てる
      pen += Math.max(0, Math.abs(ang-HAND_CFG.tipTilt)-10)*0.15;
      if(dd[1] > 0.35) pen += (dd[1]-0.35)*20;                          // 手の方へ折り返すのは不自然
    }
    const p1 = norm(sub(pts[1],pts[0]));
    const mcp = Math.atan2(dot(p1,H.N), dot(p1,H.F))/DEG;              // 付け根の関節（反らすのは苦手）
    if(mcp < -5) pen += (-5-mcp)*1.2;
    if(mcp > 90) pen += (mcp-90)*0.5;
    if(c*p2/DEG > 88) pen += (c*p2/DEG-88)*0.3;
    pen += Math.abs(c-COUPLE[f])*2;
    for(let s=0;s<3;s++) for(let t=0;t<=1.001;t+=0.25){                 // 他の弦に触れないか
      if(kind!=='hover' && s===2 && t>0.3) continue;
      const P = lerp3(pts[s],pts[s+1],t), r = lerp(R[s],R[s+1],t);
      if(Math.abs(P[1]) < halfW(P[0]) + r*0.5){ const cl = P[2]-r-(stringZ(P[0])+0.6); if(cl<0) pen += -cl*1.5; }
    }
    if(!best || pen<best.pen) best = {pen, pts};
  }
  const out = padToTip(best.pts, Lbone[2]); out.pen = best.pen;
  return out;
}
// 「指の腹の点」→ モデルの tip 関節の位置に戻す
function padToTip(pts, l3){
  return [pts[0], pts[1], pts[2], add(pts[2], mul(norm(sub(pts[3],pts[2])), l3))];
}

function ik3(A, C, l1, l2, pole){
  const d = sub(C,A); let dist = vlen(d);
  dist = Math.min(Math.max(dist, Math.abs(l1-l2)+0.01), l1+l2-0.01);
  const ax = norm(d), pv = sub(pole,A);
  const perp = norm(sub(pv, mul(ax, dot(pv,ax))));
  const ca = (l1*l1+dist*dist-l2*l2)/(2*l1*dist), sa = Math.sqrt(Math.max(0,1-ca*ca));
  return add(A, add(mul(ax,l1*ca), mul(perp,l1*sa)));
}

// セーハ：人差し指を寝かせて、指の腹で何本もまとめて押さえる
function solveBarre(L, K, barre, H){
  const x = fretX(barre.fret) - 6;
  const zc = FRET_TOP + 7.2;                                  // 指の中心の高さ（指の腹で弦を押し下げる）
  const T = [x-1.5, strY(barre.from,x) - 3, zc];             // 指の腹の点（いちばん端の弦より少し外）
  const D = [x-0.8, T[1]+L[2]+PAD_EXT, zc+0.4];
  let P;
  if(barre.to-barre.from+1 >= 3) P = [x, D[1]+L[1], zc+1.0];
  else P = ik3(K, D, L[0], L[1], add(mul(add(K,D),0.5), add(mul(H.N,-40),[0,0,25])));
  return padToTip([K, P, D, T], L[2]);
}

/* 手全体の形を作って「どれくらい無理があるか（コスト）」を返す */
function buildHand(chord, rig, prm, thumbStart){
  const barre = chord.barre;
  const fullBarre = !!barre && (barre.to-barre.from+1) >= 3;
  const H = handFrame(fullBarre, prm);
  const used = {};
  chord.fingers.forEach((f,s)=>{ if(!f) return; (used[f] ||= {strings:[], fret:chord.frets[s]}).strings.push(s); });
  // 指先の位置（フレットのすぐ手前。同じフレットに何本か並ぶときは斜めにずらす）
  const tipX = {}, byFret = {};
  for(const f in used){ if(barre && +f===1) continue; (byFret[used[f].fret] ||= []).push(+f); }
  for(const fr in byFret){
    const list = byFret[fr].sort((a,b)=>a-b), n = list.length;
    list.forEach((f,i)=>{ tipX[f] = fretX(+fr) - 4.5 - (n-1-i)*4.5; });
  }
  if(barre) tipX[1] = fretX(barre.fret) - 6;

  // 指の付け根（ナックル）の並びはモデルの実寸。指先に合わせて手全体を前後にずらす
  const kRest = f => toWorld(H, [0,0,0], sub(rig.rest[jointName(f,1)], rig.rest[jointName(1,1)]));
  let anc = 0, cnt = 0;
  for(const f in tipX){ anc += tipX[f] - kRest(+f)[0]; cnt++; }
  anc = cnt ? anc/cnt : fretX(1)-2;
  anc = Math.max(4, anc);
  // 手首の位置：人差し指の付け根が [anc, yK, zK] に来るように
  const kIdx = toWorld(H, [0,0,0], rig.rest[jointName(1,1)]);
  const W = sub([anc, prm.yK, prm.zK], kIdx);
  const K = {}, M = {};
  for(let f=1; f<=4; f++){ K[f] = toWorld(H, W, rig.rest[jointName(f,1)]); M[f] = toWorld(H, W, rig.rest[jointName(f,0)]); }

  let cost = 0;
  const fingers = {};
  for(let f=1; f<=4; f++){
    const L = rig.lengths[f];
    let pts, mode, string = null, T;  // T = 指の腹の目標点
    if(barre && f===1){
      mode = 'barre'; string = barre.from; pts = solveBarre(L, K[1], barre, H);
    } else if(used[f]){
      mode = 'press'; string = Math.min(...used[f].strings);
      const x = tipX[f];
      T = [x, strY(string,x)+1.0, FRET_TOP + 0.35 + PAD_R];
      pts = solveFinger(f, L, K[f], T, H, 'press');
      cost += pts.pen;
      // 届かない／縮こまりすぎ：指先が目標からずれた分
      const pd = vlen(sub(add(pts[2], mul(norm(sub(pts[3],pts[2])), L[2]+PAD_EXT)), T));
      cost += pd*pd*0.5;
    } else {
      mode = 'hover';   // 使わない指：軽く曲げて弦の少し上に浮かせる
      const x = K[f][0]+2;
      T = [x, f===4 ? 20 : 12, FRET_TOP + PAD_R + (f===4 ? 10 : 9)];
      pts = solveFinger(f, L, K[f], T, H, 'hover');
      cost += pts.pen*0.3;
    }
    const axis = norm(cross(sub(pts[3],pts[0]), H.N));
    fingers[f] = {mode, pts, string, axis};
  }
  // 手のひら・手首がネックにめり込まない
  const palmPts = [];
  for(let f=1; f<=4; f++){ palmPts.push([K[f],9], [M[f],11], [mul(add(K[f],M[f]),0.5),12]); }
  palmPts.push([W,20], [toWorld(H, W, rig.rest[THUMB_JOINTS[0]]),13]);
  for(const [p,r] of palmPts){ const g = neckSD(p); if(g < r) cost += (r-g)*(r-g)*1.5; }
  // 手首の曲がりすぎ（前腕の向きとの角度）
  const bend = Math.acos(Math.max(-1, Math.min(1, dot(H.F, mul(norm(HAND_CFG.arm),-1)))))/DEG;
  if(bend > 30) cost += (bend-30)*(bend-30)*0.02;

  // 親指：関節が自然に曲がる範囲の中で、ネックの裏に軽く当たる形をさがす（thumb.js）
  rig.thumbModel ||= makeThumbModel(THUMB_JOINTS.map(n=>rig.rest[n]), THUMB_JOINTS.map(n=>rig.restBasis[n]), [0,-1,0]);
  const toWd = v => toWorld(H, [0,0,0], v);
  const th = solveThumb(rig.thumbModel, v=>toWorld(H, W, v), toWd,
                        { xTarget: (K[1][0]+K[2][0])/2, yTarget: -5, start: thumbStart });
  cost += th.cost;
  return {cost, H, W, K, M, fingers, tipX, th, toWd, barre};
}

// 手の向き・位置を少しずつ変えて、いちばん無理のない持ち方をさがす
const PRM_STEP = {pitch:8, yaw:8, roll:8, yK:5, zK:5};
const PRM_LIM  = {pitch:[-45,45], yaw:[-35,35], roll:[-35,35], yK:[26,56], zK:[-34,2]};
const poseCache = new Map();
function optimizeHand(chord, rig){
  const fullBarre = !!chord.barre && (chord.barre.to-chord.barre.from+1) >= 3;
  let prm = {pitch:0, yaw:0, roll:0, yK: fullBarre ? HAND_CFG.yKb : HAND_CFG.yK, zK: fullBarre ? HAND_CFG.zKb : HAND_CFG.zK};
  let best = buildHand(chord, rig, prm), thStart = best.th.ang;
  for(let scale=1; scale>0.1; scale*=0.5){
    let improved = true, guard = 0;
    while(improved && guard++ < 12){
      improved = false;
      for(const k in PRM_STEP) for(const sgn of [-1,1]){
        const v = Math.min(PRM_LIM[k][1], Math.max(PRM_LIM[k][0], prm[k] + sgn*PRM_STEP[k]*scale));
        if(v === prm[k]) continue;
        const cand = {...prm, [k]: v};
        const r = buildHand(chord, rig, cand, thStart);
        if(r.cost < best.cost - 1e-4){ best = r; prm = cand; thStart = r.th.ang; improved = true; }
      }
    }
  }
  best.prm = prm;
  return best;
}

export function computePose(chord, rig){
  const t0 = performance.now();
  let hb = poseCache.get(chord.name);
  if(!hb){ hb = optimizeHand(chord, rig); poseCache.set(chord.name, hb); }
  const {H, W, K, M, fingers, tipX, th, toWd, barre} = hb;
  const thumb = th.pts.map(v=>toWorld(H, W, v));

  // 関節ごとの位置と向き
  const joints = [];
  const J = (name, pos, fwd, dorsal, f=0, i=0) => joints.push({name, pos, fwd:norm(fwd), dorsal:norm(dorsal), f, i});
  J('wrist', W, H.F, H.U);
  { const A = norm(HAND_CFG.arm); const fw = mul(A,-1); J('forearm', W, fw, sub(H.U, mul(fw, dot(H.U,fw)))); }
  for(let f=1; f<=4; f++){
    { const Bm = rig.restBasis[jointName(f,0)]; J(jointName(f,0), M[f], sub(K[f],M[f]), add(add(mul(H.X,Bm[1][0]), mul(H.Y,Bm[1][1])), mul(H.Z,Bm[1][2])), f, 0); }
    const {pts, axis} = fingers[f];
    for(let i=0;i<4;i++){
      const fwd = norm(sub(pts[Math.min(i+1,3)], pts[Math.min(i,2)]));
      J(jointName(f,i+1), pts[i], fwd, cross(fwd, axis), f, i+1);
    }
  }
  for(let i=0;i<4;i++){
    const B = rig.thumbModel.restBasis[i], R = th.Rs[i];
    const mv = v => [R[0][0]*v[0]+R[0][1]*v[1]+R[0][2]*v[2], R[1][0]*v[0]+R[1][1]*v[1]+R[1][2]*v[2], R[2][0]*v[0]+R[2][1]*v[1]+R[2][2]*v[2]];
    J(THUMB_JOINTS[i], thumb[i], toWd(mv(mul(B[2],-1))), toWd(mv(B[1])), 5, i);
  }

  // 弦：押さえたところで指板側へ沈む
  const str = [0,1,2,3].map(s=>{
    if(!chord.frets[s]) return null;
    const f = chord.fingers[s];
    const cx = (barre && f===1 && chord.frets[s]===barre.fret) ? fretX(barre.fret)-6 : tipX[f];
    return {contact: cx, fret: fretX(chord.frets[s])};
  });
  const xs = Object.values(tipX);
  const center = xs.length ? (Math.min(...xs)+Math.max(...xs))/2 : fretX(1.5);
  window.__thumbInfo = {ang: th.ang, cost: th.cost, total: hb.cost, prm: hb.prm, ms: performance.now()-t0};
  return {joints, fingers, str, chord, target:[Math.min(Math.max(center,30),80), 10, -4]};
}

/* ---------- コードチェンジのアニメーション ---------- */
export function blendPose(A, B, t){
  const ease = t<.5 ? 4*t*t*t : 1-Math.pow(-2*t+2,3)/2, lift = Math.sin(Math.PI*t);
  const moved = {};
  for(let f=1; f<=4; f++) moved[f] = vlen(sub(A.fingers[f].pts[3], B.fingers[f].pts[3])) > 0.5;
  const up = [0, 0.35, 0.94];
  const joints = A.joints.map((ja,k)=>{
    const jb = B.joints[k];
    let pos = lerp3(ja.pos, jb.pos, ease);
    if(jb.f>=1 && jb.f<=4 && moved[jb.f] && jb.i>=2) pos = add(pos, mul(up, lift*[0,0,6,11,14][jb.i]));
    return {...jb, pos, fwd:norm(lerp3(ja.fwd, jb.fwd, ease)), dorsal:norm(lerp3(ja.dorsal, jb.dorsal, ease))};
  });
  const fingers = {};
  for(let f=1; f<=4; f++) fingers[f] = {...B.fingers[f], mode: t<.5 ? A.fingers[f].mode : B.fingers[f].mode,
    pts: A.fingers[f].pts.map((p,i)=>lerp3(p, B.fingers[f].pts[i], ease))};
  return {joints, fingers, str: t<.5 ? A.str : B.str, chord: B.chord, target: lerp3(A.target, B.target, ease)};
}
