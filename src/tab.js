/* =========================================================
   タブ譜（メロディ弾き）
   ・曲は「できごと（event）」の並び： {t: 何拍目, d: 長さ（拍）, notes:[{s: 弦, f: フレット, k: 指}]}
       s は 0=6弦 … 5=1弦（data.js と同じ）、f=0 は開放弦、k=1〜4 は押さえる指（0 = 押さえない）
   ・読み込めるもの：
       文字のタブ譜（e|---0---3--| のような6行）・MIDIファイル・MusicXML（.xml / .musicxml / .mxl）
       サンプル曲用の短い書き方（「弦-フレット*拍」を並べる）
   ・どの弦のどのフレットで弾くか・どの指で押さえるかは、手の移動がいちばん少なくなるように自動で決める
     （1つのフレットに1本の指＝人差し指の位置「ポジション」を決めて、そこから中指・薬指・小指）
   ========================================================= */
import { STRING_MIDI, getChord, resolveChord } from './data.js';

const NS = 6, MAX_F = 15;
const NOTE_NAMES = ['C','C♯','D','E♭','E','F','F♯','G','A♭','A','B♭','B'];
export const noteName = m => NOTE_NAMES[((m%12)+12)%12] + (Math.floor(m/12)-1);

/* ---------- サンプル曲の短い書き方 ----------
   "3-0 3-0 2-3*2 | r*0.5 1-0/2"
   弦番号（1弦〜6弦）-フレット、*2 = 2拍、/2 = 半拍、r = 休み、| は小節線（読み飛ばす）、[3-0 2-1] = 同時に弾く */
export function parseCompact(str){
  const ev = []; let t = 0;
  const toks = str.replace(/\[([^\]]*)\]/g, (_,a)=>a.trim().split(/\s+/).join('+')).split(/\s+/).filter(x=>x && x !== '|');
  for(const tok of toks){
    const m = tok.match(/^([^*/]+)(?:([*/])([\d.]+))?$/); if(!m) continue;
    const d = m[2] === '*' ? +m[3] : m[2] === '/' ? 1/+m[3] : 1;
    if(m[1] !== 'r'){
      const notes = m[1].split('+').map(p=>{ const [sn, f] = p.split('-').map(Number); return {s: NS - sn, f}; });
      ev.push({t, d, notes});
    }
    t += d;
  }
  return finish(ev, true);
}

/* ---------- 文字のタブ譜 ----------
   6行ひとまとまり（上が1弦）。数字が並んでいる列が音。h p / \ b ~ などの記号は読み飛ばす。
   リズムは書いていないことが多いので、音と音のすき間（文字数）から長さを決める：
   いちばんよく出てくるすき間を8分音符（半拍）とみなす */
export function parseTabText(text){
  const lines = text.replace(/\r/g,'').split('\n');
  const isStr = l => /^\s*[a-gA-G]?[#b]?\s*[|:]?[-0-9|hpbr/\\~x.()<>*=^]{6,}/.test(l) && (l.match(/-/g)||[]).length >= 3;
  const blocks = [];
  for(let i=0;i<lines.length;i++){
    if(!isStr(lines[i])) continue;
    let j = i; while(j < lines.length && isStr(lines[j])) j++;
    if(j - i >= 6) for(let k=i; k+6<=j; k+=6) blocks.push(lines.slice(k, k+6));
    i = j - 1;
  }
  if(!blocks.length) throw new Error('タブ譜（6本の線）が見つかりませんでした');
  // 1ブロックごとに、列 → 音
  const cols = []; let base = 0;
  for(const b of blocks){
    // 行の頭の弦名と最初の | を取りのぞいて、列をそろえる
    const body = b.map(l => l.replace(/^\s*[a-gA-G]?[#b]?\s*[|:]?/, ''));
    const w = Math.max(...body.map(l=>l.length));
    let bars = 0;
    for(let c=0; c<w; c++){
      if(body.some(l=>l[c] === '|')){ bars++; continue; }
      const notes = [];
      for(let r=0;r<6;r++){
        const l = body[r];
        if(/\d/.test(l[c] || '') && !/\d/.test(l[c-1] || '')){
          let k = c; while(/\d/.test(l[k] || '')) k++;
          const f = +l.slice(c, k);
          if(f <= 24) notes.push({s: 5 - r, f});
        }
      }
      if(notes.length) cols.push({c: base + c - bars, notes});
    }
    base += w - bars + 2;
  }
  // すき間 → 拍
  const gaps = {};
  for(let i=1;i<cols.length;i++){ const g = cols[i].c - cols[i-1].c; if(g > 0 && g < 20) gaps[g] = (gaps[g]||0) + 1; }
  const unit = +Object.entries(gaps).sort((a,b)=>b[1]-a[1] || a[0]-b[0])[0]?.[0] || 2;
  const ev = cols.map((col,i)=>({t: col.c/unit/2, d: 0, notes: col.notes}));
  ev.forEach((e,i)=>{ e.d = i+1 < ev.length ? Math.min(4, ev[i+1].t - e.t) : 1; });
  // 小さなずれをならす（16分音符きざみ）
  ev.forEach(e=>{ e.t = Math.round(e.t*4)/4; e.d = Math.max(0.25, Math.round(e.d*4)/4); });
  const t0 = ev.length ? ev[0].t : 0; ev.forEach(e=>e.t -= t0);
  return finish(ev, true);
}

/* ---------- MIDI ---------- */
export function parseMidi(buf){
  const d = new DataView(buf); let p = 0;
  const str = n => { let s=''; for(let i=0;i<n;i++) s += String.fromCharCode(d.getUint8(p+i)); p += n; return s; };
  const u32 = () => { const v = d.getUint32(p); p += 4; return v; }, u16 = () => { const v = d.getUint16(p); p += 2; return v; };
  if(str(4) !== 'MThd') throw new Error('MIDIファイルではありません');
  const hl = u32(); u16(); const ntr = u16(), div = u16(); p += hl - 6;
  if(div & 0x8000) throw new Error('この形式（SMPTE）のMIDIには対応していません');
  const tracks = []; let tempo = 0;
  for(let tr=0; tr<ntr && p < d.byteLength; tr++){
    const id = str(4), len = u32(), end = p + len;
    if(id !== 'MTrk'){ p = end; continue; }
    let t = 0, run = 0; const on = {}, notes = [];
    const vlq = () => { let v = 0, b; do { b = d.getUint8(p++); v = (v<<7) | (b&0x7f); } while(b & 0x80); return v; };
    while(p < end){
      t += vlq();
      let st = d.getUint8(p);
      if(st & 0x80){ p++; if(st < 0xf0) run = st; } else st = run;
      const type = st & 0xf0, ch = st & 0x0f;
      if(st === 0xff){ const mt = d.getUint8(p++), ml = vlq(); if(mt === 0x51 && !tempo) tempo = (d.getUint8(p)<<16)|(d.getUint8(p+1)<<8)|d.getUint8(p+2); p += ml; }
      else if(st === 0xf0 || st === 0xf7){ p += vlq(); }
      else if(type === 0x90 || type === 0x80){
        const n = d.getUint8(p++), v = d.getUint8(p++);
        const key = ch*128 + n;
        if(type === 0x90 && v > 0){ (on[key] ||= []).push(t); }
        else if(on[key]?.length){ const t0 = on[key].shift(); if(ch !== 9) notes.push({m: n, t: t0/div, d: (t - t0)/div}); }
      }
      else if(type === 0xc0 || type === 0xd0) p += 1;
      else p += 2;
    }
    p = end;
    if(notes.length) tracks.push(notes);
  }
  if(!tracks.length) throw new Error('音が入っていませんでした');
  // いちばん音の多いトラックをメロディとして使う（同時に鳴る音は、いちばん高い音だけ）
  tracks.sort((a,b)=>b.length - a.length);
  const bpm = tempo ? Math.round(60e6/tempo) : 100;
  return {...fromPitches(skyline(tracks[0])), bpm, info:`MIDIの${tracks.length}つのトラックのうち、いちばん音の多いトラックから取り込みました`};
}

/* ---------- MusicXML ---------- */
export async function readMxl(buf){
  // .mxl は zip。中の楽譜ファイル（META-INF 以外の .xml / .musicxml）を取り出す
  const d = new DataView(buf); let p = 0; const files = {};
  while(p + 30 < d.byteLength && d.getUint32(p, true) === 0x04034b50){
    const method = d.getUint16(p+8, true), csize = d.getUint32(p+18, true), nlen = d.getUint16(p+26, true), xlen = d.getUint16(p+28, true);
    const name = new TextDecoder().decode(new Uint8Array(buf, p+30, nlen));
    const data = new Uint8Array(buf, p+30+nlen+xlen, csize);
    files[name] = {method, data};
    p += 30 + nlen + xlen + csize;
  }
  const name = Object.keys(files).find(n => !n.startsWith('META-INF') && /\.(xml|musicxml)$/i.test(n));
  if(!name) throw new Error('.mxl の中に楽譜が見つかりませんでした');
  const f = files[name];
  if(f.method === 0) return new TextDecoder().decode(f.data);
  if(typeof DecompressionStream === 'undefined') throw new Error('このブラウザでは .mxl を開けません（.musicxml で保存してください）');
  const s = new Blob([f.data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return await new Response(s).text();
}
export function parseMusicXML(text){
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const part = doc.querySelector('part');
  if(!part) throw new Error('MusicXMLの楽譜が見つかりませんでした');
  let div = 1, t = 0, lastT = 0, octShift = 0, bpm = 0;
  const raw = [];
  const q = (el, sel) => el.querySelector(sel);
  for(const meas of part.querySelectorAll(':scope > measure')){
    for(const el of meas.children){
      if(el.tagName === 'attributes'){
        const dv = q(el, 'divisions'); if(dv) div = +dv.textContent || 1;
        const oc = q(el, 'transpose octave-change') || q(el, 'clef clef-octave-change'); if(oc) octShift = +oc.textContent || 0;
      } else if(el.tagName === 'direction' || el.tagName === 'sound'){
        const snd = el.tagName === 'sound' ? el : q(el, 'sound'); if(snd?.getAttribute('tempo') && !bpm) bpm = Math.round(+snd.getAttribute('tempo'));
      } else if(el.tagName === 'backup'){ t -= +q(el,'duration').textContent/div; }
      else if(el.tagName === 'forward'){ t += +q(el,'duration').textContent/div; }
      else if(el.tagName === 'note'){
        if(q(el, 'grace')) continue;
        const dur = +(q(el, 'duration')?.textContent || 0)/div;
        const chord = !!q(el, 'chord');
        const start = chord ? lastT : t;
        if(!chord) { lastT = t; t += dur; }
        if(q(el, 'rest')) continue;
        const tie = el.querySelector('tie[type="stop"]');
        const ps = q(el, 'pitch'); if(!ps) continue;
        const step = q(ps,'step').textContent, alter = +(q(ps,'alter')?.textContent || 0), oct = +q(ps,'octave').textContent;
        const m = 12*(oct+1) + {C:0,D:2,E:4,F:5,G:7,A:9,B:11}[step] + alter + 12*octShift;
        const sEl = q(el, 'technical string'), fEl = q(el, 'technical fret');
        if(tie){ let prev = null; for(let i=raw.length-1;i>=0;i--) if(raw[i].m === m){ prev = raw[i]; break; }
                 if(prev){ prev.d = start + dur - prev.t; continue; } }
        raw.push({m, t: start, d: dur, s: sEl ? NS - +sEl.textContent : null, f: fEl ? +fEl.textContent : null});
      }
    }
  }
  if(!raw.length) throw new Error('音が入っていませんでした');
  const hasTab = raw.every(n => n.s != null && n.f != null && n.s >= 0 && n.s < NS);
  if(hasTab){
    const byT = new Map();
    for(const n of raw){ const k = Math.round(n.t*48); if(!byT.has(k)) byT.set(k, {t: n.t, d: n.d, notes: []}); const e = byT.get(k); if(!e.notes.some(x=>x.s===n.s)) e.notes.push({s: n.s, f: n.f}); e.d = Math.max(e.d, n.d); }
    return {...finish([...byT.values()].sort((a,b)=>a.t-b.t), true), bpm: bpm || 90, info:'タブ譜（弦とフレット）つきのMusicXMLから取り込みました'};
  }
  return {...fromPitches(skyline(raw)), bpm: bpm || 90, info:'MusicXMLの1つ目のパートから、メロディ（いちばん高い音）を取り込みました'};
}

// 同時に鳴る音のうち、いちばん高い音だけ残す（メロディだけにする）
function skyline(notes){
  const byT = new Map();
  for(const n of notes){ const k = Math.round(n.t*48); const o = byT.get(k); if(!o || n.m > o.m) byT.set(k, n); }
  const out = [...byT.values()].sort((a,b)=>a.t-b.t);
  out.forEach((n,i)=>{ if(i+1 < out.length) n.d = Math.min(n.d || 1, out[i+1].t - n.t); });
  return out;
}
// 音の高さだけの曲 → ギターで弾ける高さにそろえて（オクターブ単位で上下）、弦とフレットを決める
function fromPitches(notes){
  const lo = STRING_MIDI[0], hi = STRING_MIDI[NS-1] + 12;
  let best = 0, bestScore = -1;
  for(let sh=-48; sh<=48; sh+=12){
    const score = notes.filter(n=>n.m+sh >= lo && n.m+sh <= hi).length - Math.abs(sh)/1000 - notes.filter(n=>n.m+sh < lo+5).length*0.1;
    if(score > bestScore){ bestScore = score; best = sh; }
  }
  const t0 = notes[0].t;
  const ev = notes.map(n=>{
    let m = n.m + best; while(m < lo) m += 12; while(m > STRING_MIDI[NS-1] + MAX_F) m -= 12;
    return {t: Math.round((n.t - t0)*12)/12, d: Math.max(0.25, Math.round((n.d || 0.5)*12)/12), notes: [{m}]};
  });
  return finish(ev, false);
}

/* ---------- 弦・フレット・指を決める ----------
   ポジション P（人差し指のフレット）を音ごとに決める。手の移動・高いフレット・指の広げすぎを「コスト」にして、
   曲全体でいちばん楽になる組み合わせを選ぶ（動的計画法） */
function choices(e, fixed){
  if(fixed) return [e.notes.map(n=>({s:n.s, f:n.f}))];
  // 同時に鳴る音それぞれの候補（弦, フレット）から、弦が重ならない組み合わせを作る
  const per = e.notes.map(n=>{ const c = []; for(let s=0;s<NS;s++){ const f = n.m - STRING_MIDI[s]; if(f >= 0 && f <= MAX_F) c.push({s, f}); } return c; });
  let combos = [[]];
  for(const c of per){
    const next = [];
    for(const cb of combos) for(const x of c) if(!cb.some(y=>y.s===x.s)) next.push([...cb, x]);
    combos = next.slice(0, 400);
  }
  if(!combos.length) combos = [per.map(c=>c[0]).filter(Boolean)];
  const span = cb => { const fs = cb.filter(n=>n.f>0).map(n=>n.f); return fs.length ? Math.max(...fs) - Math.min(...fs) : 0; };
  return combos.sort((a,b)=>span(a)-span(b)).slice(0, 10);
}
function finish(ev, fixed){
  ev = ev.filter(e=>e.notes.length);
  const opts = ev.map(e=>choices(e, fixed));
  const Ps = cb => {
    const fs = cb.filter(n=>n.f>0).map(n=>n.f);
    if(!fs.length) return Array.from({length:12}, (_,i)=>i+1);
    const lo = Math.min(...fs), hi = Math.max(...fs), out = [];
    for(let P = Math.max(1, hi-4); P <= lo; P++) out.push(P);
    return out.length ? out : [lo];
  };
  const local = (cb, P) => {
    let c = 0.04*P;
    for(const n of cb){ if(n.f === 0) { c += 0.15; continue; } const k = n.f - P + 1; if(k > 4) c += 3.5*(k-4); }   // 指を4フレットより広げるのはつらい（それなら手の位置をずらす）
    return c;
  };
  // 動的計画法
  let prev = null;
  const table = opts.map((cbs, i)=>{
    const states = [];
    cbs.forEach((cb, ci)=>Ps(cb).forEach(P=>{
      const l = local(cb, P);
      let best = null;
      if(!prev) best = {cost: l + 0.15*(P-1), from: -1};
      else prev.forEach((st, si)=>{
        const mv = Math.abs(P - st.P), open = !cb.some(n=>n.f>0);
        const c = st.cost + l + (open ? 0.7*mv : mv*0.9 + (mv ? 0.6 : 0)) + 0.05*cb.reduce((a,n)=>a+Math.min(...st.cb.map(m=>Math.abs(m.s-n.s))),0);
        if(!best || c < best.cost) best = {cost: c, from: si};
      });
      states.push({cb, P, ...best});
    }));
    prev = states;
    return states;
  });
  // うしろからたどる
  if(table.length){
    let si = table[table.length-1].reduce((b,s,i,a)=>s.cost < a[b].cost ? i : b, 0);
    const pick = [];
    for(let i=table.length-1; i>=0; i--){ pick[i] = table[i][si]; si = pick[i].from; }
    // 指は前から順に決める：同じ音が続く時は、同じ指で押さえ続ける
    let held = {};   // '弦.フレット' → 指
    for(let i=0;i<ev.length;i++){
      const st = pick[i];
      if(i && st.P !== pick[i-1].P) held = {};
      ev[i].P = st.P;
      const ns = assignFingers(st.cb.map(n=>({...n})), st.P, held);
      ev[i].notes = [...ns]; ev[i].barre = ns.barre || null;
      for(const n of ns) if(n.f > 0 && n.k) held[n.s + '.' + n.f] = n.k;
    }
  }
  ev.forEach(e=>{ e.notes.forEach(n=>{ n.m = STRING_MIDI[n.s] + n.f; }); });
  return {events: ev, length: ev.length ? Math.ceil(ev[ev.length-1].t + ev[ev.length-1].d) : 0};   // length：曲の長さ（拍）
}
// 指：1フレットに1本（ポジション P のフレットが人差し指）。同じフレットに何本も並ぶときは、弦の順に次の指へ
function assignFingers(notes, P, held = {}){
  const pressed = notes.filter(n=>n.f>0).sort((a,b)=>a.f-b.f || a.s-b.s);
  const used = new Set();
  const atP = pressed.filter(n=>n.f===P);
  let barre = null;
  if(atP.length >= 3){ barre = {fret:P, finger:1, from: Math.min(...atP.map(n=>n.s)), to: Math.max(...atP.map(n=>n.s))}; atP.forEach(n=>n.k = 1); used.add(1); }
  // さっきと同じ音は、さっきと同じ指で（その指がまだ空いていて、フレットの順番がくずれなければ）
  for(const n of pressed){
    if(n.k) continue;
    const k = held[n.s + '.' + n.f];
    if(!k || used.has(k) || Math.abs(k - (n.f - P + 1)) > 1) continue;
    // 指の順番がくずれない（フレットが低いほど若い指。同じフレットなら、太い弦ほど若い指）
    const ok = pressed.every(m => m === n || !m.k || (m.f !== n.f ? (m.f < n.f) === (m.k < k) : (m.s < n.s) === (m.k < k)));
    if(ok){ n.k = k; used.add(k); }
  }
  for(const n of pressed){
    if(n.k) continue;
    let k = Math.min(4, Math.max(1, n.f - P + 1));
    while(used.has(k) && k < 4) k++;
    while(used.has(k) && k > 1) k--;
    n.k = k; used.add(k);
  }
  // 前と同じ指を使ったせいで指の順番がくずれたら、前のことは気にせず決め直す
  const order = (m, n) => m.f !== n.f ? (m.f < n.f) === (m.k < n.k) : (m.s < n.s) === (m.k < n.k);
  const fing = pressed.filter(n => !(barre && n.f === P));
  if(Object.keys(held).length && fing.some(m => fing.some(n => m !== n && !order(m, n)))){
    notes.forEach(n => delete n.k);
    return assignFingers(notes, P);
  }
  notes.forEach(n=>{ if(!n.f) n.k = 0; });
  if(barre) notes.barre = barre;
  return notes;
}

/* ---------- コードを押さえたまま弾く（ソロギターの弾き方） ----------
   伴奏のコードがある曲では、左手はそのコードの形を押さえたままにして、
   ・弾く音がコードの中にある時：そのまま（押さえている指で鳴らすだけ。指は動かない）
   ・コードにない音の時：空いている指（ふつうは小指）を足す。足せない時は、その弦のコードの指だけ一瞬はなす
   ・どうしても形のまま弾けない時だけ、1音ずつの押さえ方にもどす
   chords：[[コード名, 拍数], ...] の小節の並び（data.js の chords をそろえたもの）。pickup：弱起の拍数 */
// ソロギターでよく使う、軽い押さえ方（Fは1・2弦だけ人差し指でセーハする小さいF）
const SOLO_SHAPES = {
  F: {name:'F', frets:[-1,-1,3,2,1,1], fingers:[0,0,3,2,1,1], barre:{fret:1, finger:1, from:4, to:5}},
  G: {name:'G', frets:[3,2,0,0,0,3], fingers:[3,2,0,0,0,4], barre:null},   // 薬指・小指のG：人差し指が空くので、メロディ（1弦1フレットなど）を足しやすい
};
// shapes：その曲だけの押さえ方（例：禁じられた遊びのAmは5フレットのセーハ）
export function applyChordHold(events, chords, pickup = 0, shapes = {}){
  if(!chords || !chords.length) return;
  const tl = []; let t = pickup;
  for(const bar of chords) for(const [c, n] of bar){ tl.push({t, c}); t += n; }
  const segAt = x => { let i = 0; tl.forEach((k, j) => { if(k.t <= x + 1e-6) i = j; }); return i; };
  // コードが続くあいだ（1つのコードの区間）で、1音でも形のまま弾けない音があれば、その区間は1音ずつの押さえ方にする
  // （区間の途中で、コードの形と1音ずつの形を行ったり来たりすると、手がばたつくので）
  const fits = events.map(e => {
    const r = resolveChord(tl[segAt(e.t)].c), ch = r && ((shapes && shapes[r.name]) || SOLO_SHAPES[r.name] || getChord(r.name));
    return ch ? {r, ch, res: holdFit(e.notes, ch)} : null;
  });
  const bad = new Set(events.map((e, i) => fits[i] && fits[i].res ? -1 : segAt(e.t)));
  events.forEach((e, i) => {
    if(!fits[i] || bad.has(segAt(e.t))) return;
    const {r, ch, res} = fits[i];
    e.notes = res.notes; e.hold = res.hold; e.barre = res.barre; e.chord = r.name;
    // 手の位置（ポジション）はコードの形で決める（はなした指・足した指で手が動かないように）
    const pr = [...res.notes, ...res.hold].filter(n => n.f > 0 && n.k);
    const sp = ch.frets.map((f, s) => ({f, k: ch.fingers[s]})).filter(n => n.f > 0 && n.k);
    e.P = Math.max(1, Math.min(...[...sp, ...pr].map(n => n.f - n.k + 1)));
  });
}
// コードの形（ch）を押さえたまま notes を弾けるか。弾ける時は {notes, hold, barre}（hold：押さえているだけで弾かない音）
function holdFit(notes, ch){
  const barre = ch.barre ? {...ch.barre} : null;
  const units = [];                                                   // はなしてもよい単位：指1本ずつ（セーハはまとめて1つ）
  if(barre) units.push({barre: true, notes: []});
  for(let s=0;s<NS;s++){
    const f = ch.frets[s]; if(!(f > 0)) continue;
    const k = ch.fingers[s];
    if(barre && k === 1 && f === barre.fret && s >= barre.from && s <= barre.to){ units[0].notes.push({s, f, k}); continue; }
    units.push({notes: [{s, f, k}]});
  }
  if(!units.length) return null;                                      // 押さえる指のない形（開放弦だけ）は、1音ずつの押さえ方で
  const played = new Map(notes.map(n => [n.s, n]));
  // 弾く音とぶつかる単位（同じ弦で別のフレット。セーハは、それより低いフレットや開放弦を弾く時）は、はなすしかない
  const must = units.map(u => u.barre ? u.notes.some(m => played.has(m.s) && played.get(m.s).f < barre.fret)
                                       : u.notes.some(m => played.has(m.s) && played.get(m.s).f !== m.f));
  const free = units.map((u, i) => i).filter(i => !must[i]);
  let best = null;
  // はなす単位の数が少ない順に試す（2本まで）
  const subsets = [[]];
  for(const i of free) subsets.push([i]);
  for(let a=0;a<free.length;a++) for(let b=a+1;b<free.length;b++) subsets.push([free[a], free[b]]);
  for(const drop of subsets){
    const keep = units.filter((u, i) => !must[i] && !drop.includes(i));
    const r = tryAssign(notes, keep, barre);
    // ベース（いちばん太い弦の指）は、なるべく離さない
    const bassS = Math.min(...units.flatMap(u => u.notes.map(m => m.s)));
    const dropBass = drop.some(i => units[i].notes.some(m => m.s === bassS)) ? 0.8 : 0;
    if(r && (!best || drop.length < best.drop || (drop.length === best.drop && r.cost + dropBass < best.cost))) best = {...r, cost: r.cost + dropBass, drop: drop.length};
    if(best && best.drop < drop.length) break;
  }
  if(!best) return null;
  // コードの指を全部はなさないと弾けない音は、「コードを押さえたまま」とは言えない（その区間は1音ずつの押さえ方にする）
  if(units.length && !best.hold.length && !best.notes.some(n => n.f > 0 && units.some(u => u.notes.some(m => m.s === n.s && m.f === n.f)))) return null;
  return best;
}
function tryAssign(notes, keep, barre){
  const hasBarre = keep.some(u => u.barre);
  const kept = keep.flatMap(u => u.notes);
  const at = new Map(kept.map(m => [m.s, m]));
  const used = new Set(kept.map(m => m.k));
  const out = notes.map(n => ({...n, k: 0}));
  const extra = [];
  for(const n of out){
    if(n.f === 0) continue;
    const m = at.get(n.s);
    if(m && m.f === n.f) n.k = m.k;
    else if(hasBarre && n.f === barre.fret && n.s >= barre.from && n.s <= barre.to) n.k = 1;
    else extra.push(n);
  }
  // コードにない音：空いている指をためす
  const freeK = [1,2,3,4].filter(k => !used.has(k) && !(hasBarre && k === 1));
  let best = null;
  const tryK = (i, taken) => {
    if(i === extra.length){
      const all = [...kept.filter(m => !out.some(n => n.s === m.s)), ...out.filter(n => n.f > 0)];
      const nb = all.filter(m => !(hasBarre && m.k === 1));
      // 新しく足した指は、ほかの指と順番どおり（フレットが低いほど若い指、同じフレットなら太い弦ほど若い指）
      for(const n of extra) for(const m of nb){
        if(m === n) continue;
        if(m.k === n.k) return;
        if(m.f !== n.f ? (m.f < n.f) !== (m.k < n.k) : (m.s < n.s) !== (m.k < n.k)) return;
        // 指と指の間は1フレットまで（人差し指・中指は、もう1フレット広げてもよい。薬指と小指の間は広がらない）
        const dk = Math.abs(m.k - n.k), wide = (m.k <= 2 || n.k <= 2) ? 1 : 0;
        if(Math.abs(m.f - n.f) > dk + wide) return;
      }
      if(hasBarre && extra.some(n => n.f <= barre.fret)) return;
      // 手を広げすぎない（どの指も「自分のフレット」から1つまでのずれ）
      const off = nb.map(m => m.f - m.k);
      const span = off.length ? Math.max(...off) - Math.min(...off) : 0;
      if(span > 1) return;
      const fs = all.map(m => m.f);
      if(Math.max(...fs) - Math.min(...fs) > 3) return;               // 4フレットより広くは広げない
      // 足す指は、手の位置から見て「そのフレットの担当の指」に近いほどよい
      const base = all.filter(m => !extra.includes(m)).reduce((b, m) => Math.min(b, m.f - m.k + 1), 99);
      if(base !== 99 && extra.some(n => n.f - base > 3)) return;      // 押さえている形の手の位置から、4フレットより先には届かない
      const cost = span + extra.reduce((c, n) => c + 0.5*Math.abs(n.k - Math.min(4, Math.max(1, n.f - (base === 99 ? n.f : base) + 1))), 0);
      if(!best || cost < best.cost) best = {cost, ks: extra.map(n => n.k)};
      return;
    }
    for(const k of freeK){ if(taken.has(k)) continue; extra[i].k = k; taken.add(k); tryK(i + 1, taken); taken.delete(k); }
    extra[i].k = 0;
  };
  tryK(0, new Set());
  if(!best) return null;
  extra.forEach((n, i) => n.k = best.ks[i]);
  const hold = kept.filter(m => !out.some(n => n.s === m.s)).map(m => ({...m}));
  const bk = hasBarre ? {...barre} : null;
  return {notes: out, hold, barre: bk, cost: best.cost};
}

/* ---------- 押さえた指は、すぐには離さない ----------
   弾き終わった指も、次のどれかになるまでは押さえたままにする（実際の弾き方と同じ。指の動きも少なくなる）
   ・その指で別の所を押さえる　・その弦を別のフレットや開放で弾く　・手の位置（ポジション）やコードが変わる
   ・ほかの指の押さえ方と、指の順番や広げ方が合わない　・3拍たった
   押さえたままの所は e.hold に入る（光らせない） */
const okPair = (a, b) => a.k !== b.k && (a.f !== b.f ? (a.f < b.f) === (a.k < b.k) : (a.s < b.s) === (a.k < b.k))
  && Math.abs(a.f - b.f) <= Math.abs(a.k - b.k) + ((a.k <= 2 || b.k <= 2) ? 1 : 0);
function sustainFingers(events){
  if(events.sustained) return;
  events.sustained = true;
  let down = [], prev = null;
  for(const e of events){
    if(prev && (e.P !== prev.P || (e.chord || '') !== (prev.chord || ''))) down = [];
    const all = [...e.notes, ...(e.hold || [])];
    const now = all.filter(n => n.f > 0 && n.k);
    const usedK = new Set(now.map(n => n.k)), usedS = new Set(all.map(n => n.s));
    if(e.barre) for(let s=e.barre.from; s<=e.barre.to; s++) usedS.add(s);
    const keep = down.filter(d => !usedK.has(d.k) && !usedS.has(d.s) && e.t - d.t <= 3 + 1e-6
      && d.f >= (e.P || 1) && d.f <= (e.P || 1) + 3 && now.every(n => !(e.barre && n.k === 1 && d.k > 1 && d.f > e.barre.fret) ? okPair(d, n) : true));
    if(keep.length) e.hold = [...(e.hold || []), ...keep.map(d => ({s: d.s, f: d.f, k: d.k, m: STRING_MIDI[d.s] + d.f}))];
    const nd = new Map();
    for(const d of keep) nd.set(d.k, d);
    for(const n of e.notes) if(n.f > 0 && n.k) nd.set(n.k, {s: n.s, f: n.f, k: n.k, t: e.t});
    down = [...nd.values()];
    prev = e;
  }
}

/* ---------- できごと → 手の形を計算するための「コード」 ---------- */
export function eventChord(e){
  const frets = Array(NS).fill(-2), fingers = Array(NS).fill(0);
  for(const n of [...(e.hold || []), ...e.notes]){ frets[n.s] = n.f; fingers[n.s] = n.k || 0; }
  const name = 'tab:' + e.notes.map(n=>`${n.s}.${n.f}.${n.k}`).join('_') + (e.hold && e.hold.length ? '+' + e.hold.map(n=>`${n.s}.${n.f}.${n.k}`).join('_') : '') + (e.barre ? 'b' + e.barre.fret + '.' + e.barre.from : '');
  return {name, frets, fingers, barre: e.barre || null, melody: true};
}
export const eventPressed = e => e.notes.some(n=>n.f > 0) || !!(e.hold && e.hold.length);

/* ---------- メロディの指の動き（むだな動きを少なく・自然に） ----------
   ・ポジション（人差し指のフレット P）ごとに、手の構えを2つから選ぶ（前後の音を見て決める）
       spread「指を開く形」：4本の指を1フレットずつ開いて並べる。小指まで使う時・4フレットにまたがる時・
                            3本以上の弦を行き来する時。親指はネックの裏
       diag「斜めの形」　：人差し指のつけ根をネックのふちに当てて、手を少し斜めにし、指をのばして押さえる。
                            2〜3フレットの中で1〜2本の弦を弾く時。親指はネックの上から少しのぞく
   ・手の位置はポジションの間ずっと同じ（斜めの形では、人差し指のつけ根を支点に傾きだけ少し変わる）
   ・押さえ終わった指は、すぐには戻さず、その場で2mmほど浮かせて待つ
   ・その弦を開放弦や別の指で弾く時は、押さえていた指をその弦から少し上げる
   ・まだ使っていない指は、自分のフレットの上で、そのポジションでよく弾く弦の上に浮かせて待つ
   返り値：音ごとに {hover: {指: [弦, フレット, 浮かせる高さ]}, grip, home} */
export function fingerPlan(events){
  sustainFingers(events);
  const plan = [];
  let P = null, last = {}, home = 3, grip = 'spread';
  for(let i=0;i<events.length;i++){
    const e = events[i];
    if(e.P !== P){
      P = e.P; last = {};
      // このポジションのあいだに弾く音を見て、構えと、指を待たせる弦を決める
      let sum = 0, n = 0, maxRel = 0, pinky = false; const strs = new Set();
      for(let j=i; j<events.length && events[j].P === P; j++) for(const nt of [...events[j].notes, ...(events[j].hold || [])]) if(nt.f > 0){
        sum += nt.s; n++; strs.add(nt.s); maxRel = Math.max(maxRel, nt.f - P); if(nt.k === 4) pinky = true;
      }
      home = n ? Math.round(sum/n) : 3;
      grip = (pinky || maxRel >= 3 || strs.size >= 3) ? 'spread' : 'diag';
    }
    const en = [...e.notes, ...(e.hold || [])];   // 押さえている音（弾く音＋コードの形で押さえたままの音）
    const pressing = new Set(), played = new Set(e.notes.map(n=>n.s));
    for(const n of [...e.notes, ...(e.hold || [])]) if(n.f > 0 && n.k){ pressing.add(n.k); last[n.k] = {s: n.s, f: n.f}; }
    if(e.barre) pressing.add(1);
    const hover = {};
    for(let k=1;k<=4;k++){
      if(pressing.has(k)) continue;
      const l = last[k];
      // 隣の指が押さえている時は、つられて少し低く待つ
      const nb = (pressing.has(k-1) || pressing.has(k+1)) ? -0.8 : 0;
      // さっきの場所で待つと指が重なる・交差する時はよける：
      //  ・押さえている指のすぐそば（同じ弦・1フレット以内）
      //  ・指の順番が逆になる（例：薬指が3フレットを押さえているのに、小指が3フレットの上で待つ → 小指が薬指の下にもぐる）
      const near = l && en.some(n => n.f > 0 && n.s === l.s && Math.abs(n.f - l.f) <= 1);
      const flip = l && en.some(n => n.f > 0 && n.k && ((n.k < k && n.f >= l.f) || (n.k > k && n.f <= l.f)));
      if(l && !near && !flip) hover[k] = [l.s, l.f, (played.has(l.s) ? 4 : 2.2) + nb];
      else if(l){                                                   // 自分のフレット（押さえている指より順番どおりの側）の上へよける
        let fr = P + k - 1;
        for(const n of en) if(n.f > 0 && n.k){ if(n.k < k) fr = Math.max(fr, n.f); if(n.k > k) fr = Math.min(fr, n.f - 1); }
        const s2 = en.some(n => n.f > 0 && n.s === l.s && Math.abs(n.f - fr) <= 1) ? Math.min(5, l.s + 1) : l.s;
        hover[k] = [s2, Math.max(1, fr), 5];
      }
      else if(grip === 'diag') hover[k] = [home, P + Math.min(k - 1, 2), 3.5 + (k === 4 ? 1.5 : 0) + nb];   // 斜めの形：小指は薬指のそばで待つ
      else hover[k] = [home, P + k - 1, 3.5 + nb];
    }
    // 待っている指も、押さえている指・ほかの待っている指と順番どおりのフレットに
    // （例：小指が薬指より手前のフレットで待つと、薬指の下にもぐって交差して見える）
    for(let k=1;k<=4;k++){
      if(!hover[k]) continue;
      const f0 = hover[k][1];
      let lb = 1, ub = P + 3;                                       // 押さえている指から決まる、待ってよいフレットの範囲
      for(const n of en) if(n.f > 0 && n.k){ if(n.k > k) ub = Math.min(ub, n.f); if(n.k < k) lb = Math.max(lb, n.f); }
      let fr = f0;
      for(let j=1;j<k;j++) if(hover[j] && hover[j][1] >= fr) fr = hover[j][1] + 1;   // 若い指より手前では待たない
      if(ub >= lb) fr = Math.max(lb, Math.min(ub, fr));
      fr = Math.max(1, Math.min(P + 3, fr));
      if(fr !== f0) hover[k] = [hover[k][0], fr, Math.max(hover[k][2], 4)];
    }
    plan.push({hover, grip, home});
  }
  return plan;
}
