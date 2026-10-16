/* =========================================================
   なめらかにする（ループ細分割）
   三角形を4つに分けながら角を丸める。骨の影響（スキンウェイト）も一緒に補間する
   ========================================================= */
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

function mixSkin(si, sw, a, b){
  const m = new Map();
  for(const v of [a,b]) for(let k=0;k<4;k++){ const w = sw[v*4+k]; if(w>0){ const j = si[v*4+k]; m.set(j, (m.get(j)||0) + w*0.5); } }
  const top = [...m.entries()].sort((x,y)=>y[1]-x[1]).slice(0,4);
  const s = top.reduce((t,e)=>t+e[1],0) || 1;
  const idx = [0,0,0,0], wt = [0,0,0,0];
  top.forEach((e,k)=>{ idx[k]=e[0]; wt[k]=e[1]/s; });
  return [idx, wt];
}

function loopOnce(geo){
  const P = geo.attributes.position.array, SI = geo.attributes.skinIndex.array, SW = geo.attributes.skinWeight.array;
  const I = geo.index.array, nV = P.length/3;
  const edges = new Map(), nb = Array.from({length:nV}, ()=>new Set());
  const key = (a,b) => a<b ? a*nV+b : b*nV+a;
  for(let t=0;t<I.length;t+=3){
    for(let k=0;k<3;k++){
      const a = I[t+k], b = I[t+(k+1)%3], c = I[t+(k+2)%3];
      const kk = key(a,b); let e = edges.get(kk);
      if(!e){ e = {a, b, opp:[], id:0}; edges.set(kk, e); }
      e.opp.push(c); nb[a].add(b); nb[b].add(a);
    }
  }
  const boundary = new Uint8Array(nV);
  for(const e of edges.values()) if(e.opp.length < 2){ boundary[e.a] = 1; boundary[e.b] = 1; }
  const nE = edges.size, np = new Float32Array((nV+nE)*3), nsi = new Float32Array((nV+nE)*4), nsw = new Float32Array((nV+nE)*4);
  // 元の頂点
  for(let v=0; v<nV; v++){
    const ns = [...nb[v]];
    let x=0,y=0,z=0, wSelf, wN;
    if(boundary[v]){
      const bn = ns.filter(u=>{ const e = edges.get(key(u,v)); return e && e.opp.length<2; });
      if(bn.length===2){ wSelf = 0.75; wN = 0.125; for(const u of bn){ x+=P[u*3]; y+=P[u*3+1]; z+=P[u*3+2]; } }
      else { wSelf = 1; wN = 0; }
    } else {
      const n = ns.length, beta = n===3 ? 3/16 : 3/(8*n);
      wSelf = 1 - n*beta; wN = beta;
      for(const u of ns){ x+=P[u*3]; y+=P[u*3+1]; z+=P[u*3+2]; }
    }
    np[v*3] = P[v*3]*wSelf + x*wN; np[v*3+1] = P[v*3+1]*wSelf + y*wN; np[v*3+2] = P[v*3+2]*wSelf + z*wN;
    for(let k=0;k<4;k++){ nsi[v*4+k] = SI[v*4+k]; nsw[v*4+k] = SW[v*4+k]; }
  }
  // 辺の中点
  let id = nV;
  for(const e of edges.values()){
    e.id = id;
    const {a, b, opp} = e;
    for(let c=0;c<3;c++){
      np[id*3+c] = opp.length===2
        ? 0.375*(P[a*3+c]+P[b*3+c]) + 0.125*(P[opp[0]*3+c]+P[opp[1]*3+c])
        : 0.5*(P[a*3+c]+P[b*3+c]);
    }
    const [si, sw] = mixSkin(SI, SW, a, b);
    for(let k=0;k<4;k++){ nsi[id*4+k] = si[k]; nsw[id*4+k] = sw[k]; }
    id++;
  }
  const ni = [];
  for(let t=0;t<I.length;t+=3){
    const a = I[t], b = I[t+1], c = I[t+2];
    const ab = edges.get(key(a,b)).id, bc = edges.get(key(b,c)).id, ca = edges.get(key(c,a)).id;
    ni.push(a,ab,ca, ab,b,bc, ca,bc,c, ab,bc,ca);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(np,3));
  out.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(Uint16Array.from(nsi),4));
  out.setAttribute('skinWeight', new THREE.BufferAttribute(nsw,4));
  out.setIndex(ni);
  return out;
}

export function smoothSkinnedGeometry(src, iterations=2){
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', src.attributes.position.clone());
  g.setAttribute('skinIndex', new THREE.BufferAttribute(Float32Array.from(src.attributes.skinIndex.array),4));
  g.setAttribute('skinWeight', src.attributes.skinWeight.clone());
  g.setIndex(src.index.clone());
  g = mergeVertices(g, 1e-6);          // 継ぎ目の重複頂点をくっつける
  for(let i=0;i<iterations;i++) g = loopOnce(g);
  g.computeVertexNormals();
  return g;
}
