/* =========================================================
   ウクレレ・ハンドガイド（画面の操作・音・説明）
   ========================================================= */
import { STRING_NAMES, STRING_NUM, STRING_MIDI, FINGER_NAMES, FINGER_COLORS, ROOTS, TYPES, getChord, PROGRESSIONS, CHORDS } from './data.js';
import { computePose, blendPose, HAND_CFG } from './pose.js';
window.__cfg = HAND_CFG;
import { createView, VIEWS } from './view.js';
import { PATTERNS, strumState, STRUM_AMP } from './strum.js';

const state = {root:'C', type:'', mirror:false, badges:true, ghost:true, rightOn:true, focus:0, vib:[0,0,0,0]};
let view = null, rig = null;
let poseFrom = null, poseTo = null, tweenStart = 0;
const TWEEN_MS = 450;

/* =========================================================
   縦のコード表
   ========================================================= */
function renderDiagram(chord){
  const el = document.getElementById('diagram');
  const L=28, T=40, W=94, H=150, cols=4, rows=5;
  const sx = i => L + i*W/(cols-1), sy = j => T + j*H/rows;
  let s = `<rect width="150" height="210" rx="10" fill="#f6ece0"/>`;
  s += `<text x="75" y="22" text-anchor="middle" font-size="16" font-weight="800" fill="#1b1410">${chord.name}</text>`;
  for(let j=0;j<=rows;j++) s += `<line x1="${L}" x2="${L+W}" y1="${sy(j)}" y2="${sy(j)}" stroke="#555" stroke-width="${j?1.4:5}"/>`;
  for(let i=0;i<cols;i++){
    s += `<line x1="${sx(i)}" x2="${sx(i)}" y1="${T}" y2="${T+H}" stroke="#333" stroke-width="1.6"/>`;
    s += `<text x="${sx(i)}" y="${T+H+16}" text-anchor="middle" font-size="11" fill="#555">${STRING_NAMES[i]}</text>`;
    if(chord.frets[i]===0) s += `<circle cx="${sx(i)}" cy="${T-10}" r="5" fill="none" stroke="#333" stroke-width="1.6"/>`;
  }
  if(chord.barre){
    const b = chord.barre, y = (sy(b.fret-1)+sy(b.fret))/2;
    s += `<rect x="${sx(b.from)-9}" y="${y-9}" width="${sx(b.to)-sx(b.from)+18}" height="18" rx="9" fill="${FINGER_COLORS[1]}"/>`;
  }
  chord.frets.forEach((fr,i)=>{
    if(!fr) return;
    const f = chord.fingers[i];
    if(chord.barre && f===1 && fr===chord.barre.fret) {
      s += `<text x="${sx(i)}" y="${(sy(fr-1)+sy(fr))/2+4.5}" text-anchor="middle" font-size="12" font-weight="800" fill="#1b1410">1</text>`;
      return;
    }
    const y = (sy(fr-1)+sy(fr))/2;
    s += `<circle cx="${sx(i)}" cy="${y}" r="9.5" fill="${FINGER_COLORS[f]}" stroke="#1b1410" stroke-width="1.2"/>`;
    s += `<text x="${sx(i)}" y="${y+4.5}" text-anchor="middle" font-size="12" font-weight="800" fill="#1b1410">${f}</text>`;
  });
  el.innerHTML = s;
}

/* =========================================================
   押さえ方の説明文
   ========================================================= */
function renderSteps(chord){
  const ul = document.getElementById('steps');
  const items = [];
  const done = {};
  // 指番号の小さい順
  const list = [];
  chord.fingers.forEach((f,s)=>{ if(f) list.push({f,s,fret:chord.frets[s]}); });
  list.sort((a,b)=>a.f-b.f || a.s-b.s);
  for(const it of list){
    if(done[it.f]) continue;
    done[it.f] = true;
    if(chord.barre && it.f===1 && it.fret===chord.barre.fret){
      const b = chord.barre;
      const strs = [];
      for(let i=b.from;i<=b.to;i++) strs.push(STRING_NUM[i]);
      items.push(`<li data-f="1"><span class="badge" style="background:${FINGER_COLORS[1]}">1</span><div><b>人差し指</b>を寝かせて、<b>${b.fret}フレット</b>の <b>${strs[0]}〜${strs[strs.length-1]}</b>（${STRING_NAMES[b.from]}〜${STRING_NAMES[b.to]}）をまとめて押さえる</div></li>`);
      continue;
    }
    const strings = list.filter(x=>x.f===it.f).map(x=>x.s);
    items.push(`<li data-f="${it.f}"><span class="badge" style="background:${FINGER_COLORS[it.f]}">${it.f}</span><div><b>${FINGER_NAMES[it.f]}</b>で <b>${STRING_NUM[strings[0]]}（${STRING_NAMES[strings[0]]}）</b>の <b>${it.fret}フレット</b></div></li>`);
  }
  const opens = chord.frets.map((v,i)=>v===0?i:-1).filter(i=>i>=0);
  if(opens.length){
    items.push(`<li class="open"><span class="badge" style="background:#ffd36b">○</span><div>${opens.map(i=>`${STRING_NUM[i]}（${STRING_NAMES[i]}）`).join('・')} は<b>押さえずに鳴らす</b></div></li>`);
  }
  ul.innerHTML = items.join('');
  ul.querySelectorAll('li[data-f]').forEach(li=>li.onclick=()=>{ state.focus = +li.dataset.f; markFocus(); kick(); });
  state.focus = list.length ? list[0].f : 0;
  markFocus();

  // コツ
  const tips = [];
  if(!list.length) tips.push('<strong>どこも押さえない</strong>コードです。左手は軽くネックに添えるだけでOK。');
  if(chord.barre) tips.push('<strong>セーハ：</strong>人差し指をまっすぐ伸ばし、指の腹より少し親指側（骨の硬いところ）で押さえると音が出やすいです。親指はネックの裏でしっかり支えます。');
  if(list.length && !chord.barre) tips.push('<strong>指を立てる：</strong>第一関節を曲げて、指先で真上から押さえると、となりの弦に触れずにきれいに鳴ります。');
  if(list.length) tips.push('<strong>フレットのすぐ近く：</strong>金属の棒（フレット）のすぐ左側を押さえると、弱い力でもビビりません。');
  const fingersUsed = new Set(chord.fingers.filter(Boolean)).size;
  if(fingersUsed>=3) tips.push('<strong>置く順番：</strong>遠い弦（4弦側）を押さえる指から先に置くと、手の形が作りやすいです。');
  tips.push('<strong>確認：</strong>「1本ずつ鳴らす」で、こもった音の弦がないかチェックしましょう。');
  document.getElementById('tips').innerHTML = tips.join('<br>');

  // むずかしさ
  let lv = 1;
  if(fingersUsed>=2) lv=2;
  if(fingersUsed>=3) lv=3;
  if(chord.barre) lv = Math.max(lv,4);
  if(chord.barre && fingersUsed>=3) lv=5;
  document.getElementById('difficulty').textContent = 'むずかしさ ' + '★'.repeat(lv) + '☆'.repeat(5-lv);
}

function markFocus(){
  document.querySelectorAll('#steps li[data-f]').forEach(li=>li.classList.toggle('focus', +li.dataset.f===state.focus));
}

/* =========================================================
   音（カープラス・ストロング法でウクレレっぽい音を合成）
   ========================================================= */
let actx = null, master = null;
const bufCache = {};
function ensureAudio(){
  if(!actx){
    actx = new (window.AudioContext||window.webkitAudioContext)();
    master = actx.createGain(); master.gain.value = 0.7;
    const body = actx.createBiquadFilter(); body.type='peaking'; body.frequency.value=260; body.Q.value=1.2; body.gain.value=5;
    const lp = actx.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=5200;
    master.connect(body); body.connect(lp); lp.connect(actx.destination);
  }
  if(actx.state==='suspended') actx.resume();
}
// 決まった乱数
function rng(seed){ return ()=>{ seed=(seed*16807)%2147483647; return (seed-1)/2147483646; }; }
function pluckBuffer(midi){
  if(bufCache[midi]) return bufCache[midi];
  const sr = actx.sampleRate, freq = 440*Math.pow(2,(midi-69)/12);
  const len = Math.floor(sr*2.4);
  const N = Math.max(2, Math.round(sr/freq - 0.5));
  const buf = actx.createBuffer(1, len, sr), y = buf.getChannelData(0);
  const r = rng(midi*13+5);
  let prev = 0;
  for(let i=0;i<N;i++){ const v = r()*2-1; prev = prev*0.5 + v*0.5; y[i] = prev; }
  const decay = 0.9965;
  for(let i=N;i<len;i++) y[i] = decay*0.5*(y[i-N] + y[i-N-1 >= 0 ? i-N-1 : 0]);
  // 頭のノイズを少し整える
  let mx = 0; for(let i=0;i<len;i++) mx = Math.max(mx, Math.abs(y[i]));
  for(let i=0;i<len;i++) y[i] /= (mx||1);
  bufCache[midi] = buf; return buf;
}
function playString(si, fret, when, vol){
  const midi = STRING_MIDI[si] + fret;
  const src = actx.createBufferSource(); src.buffer = pluckBuffer(midi);
  const g = actx.createGain();
  g.gain.setValueAtTime(0, when); g.gain.linearRampToValueAtTime(vol, when+0.004);
  g.gain.exponentialRampToValueAtTime(0.0008, when+2.3);
  src.connect(g); g.connect(master); src.start(when); src.stop(when+2.4);
  const delayMs = (when-actx.currentTime)*1000;
}
// ボタンで1回ジャラーン：右手もダウンストロークする（指が弦を通るタイミングで音を鳴らす）
let oneShot = null;
const ONE_DOWN = 170, ONE_BACK = 380;
function strum(chord){
  ensureAudio();
  oneShot = {start: performance.now()};
  playStroke(chord, 'D', actx.currentTime + ONE_DOWN/2000, 0.32, 0.016);
  kick();
}
// ダウン（4弦→1弦）／アップ（1弦→4弦）
function playStroke(chord, dir, when, vol, gap=0.012){
  for(let k=0;k<4;k++){ const si = dir==='D' ? k : 3-k; playString(si, chord.frets[si], when + k*gap, vol); }
}
function arpeggio(chord){
  ensureAudio();
  const t = actx.currentTime + 0.02;
  for(let si=0; si<4; si++) playString(si, chord.frets[si], t+si*0.45, 0.4);
}
function click(when, accent){
  const o = actx.createOscillator(), g = actx.createGain();
  o.frequency.value = accent? 1500 : 1000;
  g.gain.setValueAtTime(0.0001, when); g.gain.exponentialRampToValueAtTime(accent?0.25:0.15, when+0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, when+0.06);
  o.connect(g); g.connect(actx.destination); o.start(when); o.stop(when+0.08);
}

/* =========================================================
   画面の組み立て・操作
   ========================================================= */
const chordName = () => state.root + state.type;
function setChord(name, animate=true){
  const chord = getChord(name);
  if(!chord) return;
  const [root, type] = splitName(name);
  state.root = root; state.type = type;
  document.getElementById('chordName').textContent = name;
  const R = ROOTS.find(r=>r.id===root), T = TYPES.find(t=>t.id===type);
  document.getElementById('chordReading').textContent = `${R.read}・${T.read}`;
  renderSteps(chord);
  renderDiagram(chord);
  updateButtons();
  if(!view) return;
  const now = performance.now();
  const next = computePose(chord, view.rig);
  if(animate && poseTo){ poseFrom = currentPose(now); tweenStart = now; }
  else poseFrom = null;
  poseTo = next; window.__pose = next;
  kick();
}
function currentPose(now){
  if(!poseFrom) return poseTo;
  const t = Math.min(1, (now-tweenStart)/TWEEN_MS);
  if(t>=1){ poseFrom = null; return poseTo; }
  return blendPose(poseFrom, poseTo, t);
}
window.setChord = setChord;
function splitName(name){
  const R = ROOTS.map(r=>r.id).sort((a,b)=>b.length-a.length).find(r=>name.startsWith(r));
  return [R, name.slice(R.length)];
}

const rootRow = document.getElementById('rootRow'), typeRow = document.getElementById('typeRow');
ROOTS.forEach(r=>{
  const b = document.createElement('button'); b.className='root-btn'; b.textContent=r.id; b.dataset.root=r.id;
  b.onclick = ()=>{ const t = getChord(r.id+state.type) ? state.type : ''; setChord(r.id+t); };
  rootRow.appendChild(b);
});
TYPES.forEach(t=>{
  const b = document.createElement('button'); b.textContent=t.label; b.dataset.type=t.id;
  b.onclick = ()=>setChord(state.root+t.id);
  typeRow.appendChild(b);
});
function updateButtons(){
  rootRow.querySelectorAll('button').forEach(b=>b.classList.toggle('on', b.dataset.root===state.root));
  typeRow.querySelectorAll('button').forEach(b=>{
    b.classList.toggle('on', b.dataset.type===state.type);
    b.disabled = !getChord(state.root+b.dataset.type);
  });
}

document.getElementById('btnStrum').onclick = ()=>strum(getChord(chordName()));
document.getElementById('btnArp').onclick = ()=>arpeggio(getChord(chordName()));
function toggleBtn(id, key){
  const b = document.getElementById(id);
  b.onclick = ()=>{ state[key] = !state[key]; b.classList.toggle('on', state[key]); kick(); };
}
toggleBtn('btnBadges','badges');
toggleBtn('btnGhost','ghost');
toggleBtn('btnRight','rightOn');
toggleBtn('btnMirror','mirror');
document.querySelectorAll('[data-view]').forEach(b=>b.onclick = ()=>{
  document.querySelectorAll('[data-view]').forEach(x=>x.classList.toggle('on', x===b));
  document.getElementById('viewName').textContent = '・' + VIEWS[b.dataset.view].name;
  if(view){ view.setView(b.dataset.view); kick(); }
});

/* ---------- 進行練習 ---------- */
const prog = {idx:0, running:false, list:PROGRESSIONS[0].chords, pos:0, timer:null, t0:0, e8:0.5, nextSlot:0, showPos:0, showBeat:-1, showSlot:-1, pat:2};
const progList = document.getElementById('progList'), progChords = document.getElementById('progChords');
PROGRESSIONS.forEach((p,i)=>{
  const b = document.createElement('button'); b.textContent = p.name;
  b.onclick = ()=>{ prog.idx=i; prog.list=p.chords; prog.pos=0; stopProg(); renderProg(); setChord(prog.list[0]); };
  progList.appendChild(b);
});
const patList = document.getElementById('patList');
PATTERNS.forEach((p,i)=>{
  const b = document.createElement('button'); b.textContent = p.name;
  b.onclick = ()=>{ prog.pat = i; renderProg(); kick(); };
  patList.appendChild(b);
});
function renderProg(){
  progList.querySelectorAll('button').forEach((b,i)=>b.classList.toggle('on', i===prog.idx));
  patList.querySelectorAll('button').forEach((b,i)=>b.classList.toggle('on', i===prog.pat));
  const cur = prog.running ? prog.showPos : prog.pos;
  const nextPos = (cur+1)%prog.list.length;
  progChords.innerHTML = prog.list.map((c,i)=>{
    let cls = 'pc';
    if(prog.running && i===cur) cls+=' now';
    if(prog.running && prog.showBeat===3 && i===nextPos) cls+=' next';
    return `<div class="${cls}" data-i="${i}">${c}</div>`;
  }).join('');
  progChords.querySelectorAll('.pc').forEach(el=>el.onclick=()=>{ prog.pos=+el.dataset.i; setChord(prog.list[prog.pos]); renderProg(); });
  document.querySelectorAll('#beats .beat').forEach((el,i)=>el.classList.toggle('on', prog.running && i===prog.showBeat));
  // ストロークの譜面（↓↑）
  const P = PATTERNS[prog.pat];
  document.getElementById('patView').innerHTML = [...P.p].map((c,i)=>{
    const on = prog.running && i===prog.showSlot ? ' on' : '';
    const cnt = i%2===0 ? (i/2+1) : 'と';
    return `<div class="st${on}${c==='-'?' ghost':''}"><b>${c==='D'?'↓':c==='U'?'↑':'・'}</b><small>${cnt}</small></div>`;
  }).join('');
  document.getElementById('patTip').textContent = P.tip;
}
const bpmEl = document.getElementById('bpm');
bpmEl.oninput = ()=>{
  document.getElementById('bpmVal').textContent = bpmEl.value;
  if(prog.running){                       // 演奏中にテンポを変えても、手の振りがつながるように
    const ct = actx.currentTime, ph = (ct - prog.t0)/prog.e8, e8 = 30/(+bpmEl.value);
    prog.t0 = ct - ph*e8; prog.e8 = e8;
  }
};
// 8分音符ごとに、音と表示を少し先まで予約する
function tickProg(){
  if(!prog.running) return;
  const P = PATTERNS[prog.pat].p;
  while(prog.t0 + prog.nextSlot*prog.e8 < actx.currentTime + 0.12){
    const k = prog.nextSlot, when = prog.t0 + k*prog.e8, slot = k%8;
    const pos = (prog.pos + Math.floor(k/8)) % prog.list.length;
    const chord = getChord(prog.list[pos]);
    const delay = Math.max(0,(when-actx.currentTime)*1000);
    if(slot%2===0) click(when, slot===0);
    if(slot===0) setTimeout(()=>{ if(prog.running) setChord(chord.name); }, Math.max(0, delay-140));
    const c = P[slot];
    if(c==='D') playStroke(chord, 'D', when, slot===0 ? 0.34 : 0.28);
    if(c==='U') playStroke(chord, 'U', when, 0.17);
    setTimeout(()=>{ if(prog.running){ prog.showPos = pos; prog.showBeat = slot>>1; prog.showSlot = slot; renderProg(); } }, delay);
    prog.nextSlot++;
  }
}
function startProg(){
  ensureAudio();
  prog.running = true; prog.showPos = prog.pos; prog.showBeat = -1; prog.showSlot = -1;
  prog.e8 = 30/(+bpmEl.value);
  prog.t0 = actx.currentTime + 0.45; prog.nextSlot = 0;
  setChord(prog.list[prog.pos]);
  document.getElementById('btnProg').textContent = '■ ストップ';
  prog.timer = setInterval(tickProg, 25);
  tickProg(); kick();
}
function stopProg(){
  if(prog.running) prog.pos = (prog.pos + Math.floor(Math.max(0,prog.nextSlot-1)/8)) % prog.list.length;
  prog.running = false; clearInterval(prog.timer);
  document.getElementById('btnProg').textContent = '▶ スタート';
  renderProg(); kick();
}
document.getElementById('btnProg').onclick = ()=> prog.running ? stopProg() : startProg();

// 右手の今の状態（振りの角度・浮かせる量）
const REST = {theta: -STRUM_AMP, lift: 7};
function rightState(now){
  if(prog.running && actx){
    const ph = (actx.currentTime - prog.t0)/prog.e8;
    if(ph < -0.5) return REST;
    return strumState(ph, PATTERNS[prog.pat].p);
  }
  if(oneShot){
    const t = now - oneShot.start;
    if(t < ONE_DOWN){ const u = t/ONE_DOWN; return {theta: STRUM_AMP*Math.sin(Math.PI*(u-0.5)), lift: 0}; }
    if(t < ONE_DOWN+ONE_BACK){ const u = (t-ONE_DOWN)/ONE_BACK, e = (1-Math.cos(Math.PI*u))/2;
      return {theta: STRUM_AMP*(1-2*e), lift: 7*Math.sin(Math.PI*Math.min(1,u*1.3))}; }
    oneShot = null;
  }
  return REST;
}

/* ---------- 描画ループ（動いている時だけ描き直す） ---------- */
let dirty = true, raf = 0;
function kick(){ dirty = true; if(!raf) raf = requestAnimationFrame(loop); }
function loop(now){
  raf = 0;
  if(!view || !poseTo) return;
  const handMoving = !!poseFrom;
  const rightMoving = state.rightOn && (prog.running || !!oneShot);
  if(dirty || handMoving || rightMoving){
    // 輪切り図は左手が変わった時だけ描き直す（右手だけ動いている時は軽く）
    view.render(currentPose(now), {...state, right: state.rightOn ? rightState(now) : null, skipSide: !dirty && !handMoving});
    dirty = false;
  }
  if(handMoving || rightMoving) raf = requestAnimationFrame(loop);
}

window.addEventListener('resize', kick);

// キーボード：スペースで鳴らす
document.addEventListener('keydown', e=>{
  if(e.target.tagName==='INPUT') return;
  if(e.code==='Space'){ e.preventDefault(); strum(getChord(chordName())); }
});

renderProg();
setChord('C', false);
createView({
  mainCanvas: document.getElementById('handView'),
  sideCanvas: document.getElementById('sideView'),
  mainOverlay: document.getElementById('mainOverlay'),
  sideOverlay: document.getElementById('sideOverlay'),
  onTap: ()=>strum(getChord(chordName()))
}).then(v=>{
  view = v; window.__view = v;
  view.onChange(kick);
  document.getElementById('loading')?.remove();
  setChord(state.root+state.type, false);
  window.__ready = true;
  // 残りのコードの手の形も、ひまな時間に先に計算しておく（切り替えが引っかからないように）
  const rest = Object.keys(CHORDS);
  const idle = window.requestIdleCallback || (fn=>setTimeout(()=>fn({timeRemaining:()=>8}), 30));
  const work = dl => { while(rest.length && dl.timeRemaining() > 4) computePose(getChord(rest.shift()), view.rig); if(rest.length) idle(work); };
  idle(work);
}).catch(err=>{
  console.error(err);
  document.getElementById('mainWrap').innerHTML = '<p style="padding:30px;color:#c9b6a3">この端末では3D表示が使えません（WebGLが無効です）。</p>';
});
