/* =========================================================
   コード → 手の形（逆運動学）
   骨の長さ・指の付け根の位置は、手の3Dモデルの実寸をそのまま使う
   ========================================================= */
import { fretX, halfW, strY, FRET_TOP, NECK_BACK_Z, stringZ,
         add, sub, mul, dot, cross, vlen, norm, lerp, lerp3, DEG } from './geom.js';
import { jointName, THUMB_JOINTS } from './handrig.js';

// 指の太さ（半径・付け根〜指先）…弦に触れないかの判定用
const RAD = {1:[9.6,8.6,7.6,7.0], 2:[9.9,8.9,7.8,7.1], 3:[9.3,8.4,7.4,6.8], 4:[8.2,7.4,6.6,6.1]};
// 第一関節は第二関節の約0.75倍だけ曲がる（小指は約0.6倍）…計測研究の値
const COUPLE = {1:0.75, 2:0.75, 3:0.75, 4:0.6};
// モデルの「指先の関節(tip)」から実際の指先の皮膚までは約11mm（実測）。
// 計算では、指先の丸みの中心（tip関節から8.5mm先）を「指の腹の点」として、それを弦の上に置く
const PAD_EXT = 8.5, PAD_R = 4.8;

/* 手の向き：手首はネックの下（床側）かつ体の側。
   指の付け根はネックの床側の縁の外にあり、指はそこから立ち上がって手のひら側へ丸まる */
// 手の置き方（調整用にまとめておく）
export const HAND_CFG = {
  F: [-0.10,-0.93,0.35],  N: [0,-0.35,-0.93],      // ふつうのコード：手の甲は客席側、手首はネックの真下
  Fb:[-0.10,-0.85,0.50],  Nb:[0,-0.50,-0.85],      // セーハ：少し手前に倒す
  yK: 40, zK: -4, yKb: 48, zKb: -6,                // 人差し指の付け根の位置
};
function handFrame(barre){
  const C = HAND_CFG;
  const F = norm(barre ? C.Fb : C.F);                                    // 手首→指の付け根
  let N = barre ? C.Nb : C.N;
  N = norm(sub(N, mul(F, dot(N,F))));                                   // 手のひらの向き（ネック側）
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
      const ang = Math.acos(Math.min(1,Math.max(-1,-dd[2])))/DEG;      // 指先はなるべく真上から
      pen += Math.max(0, ang-20)*0.15;
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
  return padToTip(best.pts, Lbone[2]);
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

export function computePose(chord, rig){
  const barre = chord.barre;
  const fullBarre = !!barre && (barre.to-barre.from+1) >= 3;
  const H = handFrame(fullBarre);
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
  const yK = fullBarre ? HAND_CFG.yKb : HAND_CFG.yK, zK = fullBarre ? HAND_CFG.zKb : HAND_CFG.zK;
  // 手首の位置：人差し指の付け根が [anc, yK, zK] に来るように
  const kIdx = toWorld(H, [0,0,0], rig.rest[jointName(1,1)]);
  const W = sub([anc, yK, zK], kIdx);
  const K = {}, M = {};
  for(let f=1; f<=4; f++){ K[f] = toWorld(H, W, rig.rest[jointName(f,1)]); M[f] = toWorld(H, W, rig.rest[jointName(f,0)]); }

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
    } else {
      mode = 'hover';   // 使わない指：軽く曲げて弦の少し上に浮かせる
      const x = K[f][0]+2;
      T = [x, f===4 ? 20 : 12, FRET_TOP + PAD_R + (f===4 ? 10 : 9)];
      pts = solveFinger(f, L, K[f], T, H, 'hover');
    }
    const axis = norm(cross(sub(pts[3],pts[0]), H.N));
    fingers[f] = {mode, pts, string, axis};
  }

  // 親指：ネックの裏、人差し指と中指の間くらいに指の腹を当てる
  const TL = rig.thumbLengths;
  const T0 = toWorld(H, W, rig.rest[THUMB_JOINTS[0]]);
  const thumbX = (K[1][0]+K[2][0])/2 + 2;
  const Tpad = [thumbX, -2, NECK_BACK_Z - 5.5];             // 親指の腹（ネック裏に軽く当てる）
  const dT = norm([-0.2,-0.9,0.3]);
  const T2 = sub(Tpad, mul(dT, TL[2]+7));
  const Tc = add(T2, mul(dT, TL[2]));
  // 親指の付け根の関節は、モデルの基本姿勢に近い側へ曲げる（手のひらの皮膚がよじれないように）
  const T1rest = toWorld(H, W, rig.rest[THUMB_JOINTS[1]]);
  const T1 = ik3(T0, T2, TL[0], TL[1], add(T1rest, [0,0,-10]));
  const thumb = [T0, T1, T2, Tc];

  // 関節ごとの位置と向き
  const joints = [];
  const J = (name, pos, fwd, dorsal, f=0, i=0) => joints.push({name, pos, fwd:norm(fwd), dorsal:norm(dorsal), f, i});
  J('wrist', W, H.F, H.U);
  for(let f=1; f<=4; f++){
    { const Bm = rig.restBasis[jointName(f,0)]; J(jointName(f,0), M[f], sub(K[f],M[f]), add(add(mul(H.X,Bm[1][0]), mul(H.Y,Bm[1][1])), mul(H.Z,Bm[1][2])), f, 0); }
    const {pts, axis} = fingers[f];
    for(let i=0;i<4;i++){
      const fwd = norm(sub(pts[Math.min(i+1,3)], pts[Math.min(i,2)]));
      J(jointName(f,i+1), pts[i], fwd, cross(fwd, axis), f, i+1);
    }
  }
  // 親指のねじれ：モデルの基本姿勢での向きを引き継ぎながら、各関節を次の関節へ向ける
  const mulMV = (M, v) => add(add(mul(M[0],v[0]), mul(M[1],v[1])), mul(M[2],v[2]));
  const tmul = (M, v) => [dot(M[0],v), dot(M[1],v), dot(M[2],v)];
  const frameFrom = (fwd, dorsal) => { const Z = norm(mul(fwd,-1)); const Y = norm(sub(dorsal, mul(Z, dot(dorsal,Z)))); return [cross(Y,Z), Y, Z]; };
  const Rw = [H.X, H.Y, H.Z];
  let Rprev = Rw, Bprev = [[1,0,0],[0,1,0],[0,0,1]];
  for(let i=0;i<4;i++){
    const Bi = rig.restBasis[THUMB_JOINTS[i]];
    const fwd = norm(sub(thumb[Math.min(i+1,3)], thumb[Math.min(i,2)]));
    const pred = mulMV(Rprev, tmul(Bprev, Bi[1]));
    const R = frameFrom(fwd, pred);
    J(THUMB_JOINTS[i], thumb[i], fwd, R[1], 5, i);
    Rprev = R; Bprev = Bi;
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
