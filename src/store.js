/* =========================================================
   この端末に残すデータ（設定・取り込んだ曲など）の読み書き
   ・保存する形：{v: 版, data: 中身}。同じ中身を「控え」（キー名＋':bak'）にも残す（本体がほかのアプリや書きかけで壊れても、控えから読める）
   ・読む時は、中身を確かめる関数（check）を通す。壊れていたら控えから読む。それもだめなら、なかったことにする（アプリは止まらない）
   ・保存できなかった時（容量いっぱい・プライベートブラウズなど）は false を返す（呼んだ側で知らせる）
   ・別のタブで同じデータが変わった時は、onChange で知らせる
   ========================================================= */
const BAK = ':bak';
function ls(){ try{ return window.localStorage; }catch(e){ return null; } }

function parse(raw){
  if(raw == null) return undefined;
  try{ const o = JSON.parse(raw); return o && typeof o === 'object' && 'v' in o && 'data' in o ? o : {v: 0, data: o}; }   // v:0＝版のない古い形
  catch(e){ return undefined; }
}
// check(data, v) → 正しく直した中身（だめなら undefined）
export function load(key, check){
  const s = ls(); if(!s) return undefined;
  for(const k of [key, key + BAK]){
    let o; try{ o = parse(s.getItem(k)); }catch(e){ o = undefined; }
    if(!o) continue;
    try{ const d = check(o.data, o.v); if(d !== undefined) return d; }catch(e){ console.warn('保存データを読めませんでした', k, e); }
  }
  return undefined;
}
export function save(key, data, v = 1){
  const s = ls(); if(!s) return false;
  let json;
  try{ json = JSON.stringify({v, data}); }catch(e){ console.warn('保存データを作れませんでした', key, e); return false; }
  try{
    if(s.getItem(key) === json) return true;                             // 変わっていなければ書かない
    s.setItem(key, json);
    try{ s.setItem(key + BAK, json); }catch(e){ try{ s.removeItem(key + BAK); }catch(_){} }   // 控え（同じ中身）。入らなければ控えは捨てる（本体を優先）
    return true;
  }catch(e){
    console.warn('保存できませんでした', key, e);
    try{ s.removeItem(key + BAK); s.setItem(key, json); return true; }catch(_){ return false; }   // 控えを消して、もう一度だけ
  }
}
// 別のタブ・ウィンドウで変わった時
export function onChange(key, fn){
  try{ window.addEventListener('storage', e => { if(e.key === key) fn(); }); }catch(e){}
}

/* ---------- 中身を確かめる小さな道具 ---------- */
export const isStr = (v, max = 200) => typeof v === 'string' && v.length <= max;
export const num = (v, lo, hi, def) => (typeof v === 'number' && isFinite(v)) ? Math.min(hi, Math.max(lo, v)) : def;
export const oneOf = (v, list, def) => list.includes(v) ? v : def;
