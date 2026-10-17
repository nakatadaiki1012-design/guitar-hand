/* =========================================================
   ウクレレ・ハンドガイド（画面の操作・音・説明）
   ========================================================= */
import { STRING_NAMES, STRING_NUM, STRING_MIDI, FINGER_NAMES, FINGER_COLORS, ROOTS, TYPES, getChord, PROGRESSIONS, CHORDS, SONGS } from './data.js';
import { computePose, blendPose, HAND_CFG } from './pose.js';
window.__cfg = HAND_CFG;
import { createView, VIEWS } from './view.js';
import { PATTERNS, strumState, idleState, STRUM_AMP } from './strum.js';

const state = {root:'C', type:'', mirror:false, badges:true, ghost:true, rightMode:'always', speed:1, swing:false, split:false, focus:0, vib:[0,0,0,0]};
let view = null, rig = null;
let poseFrom = null, poseTo = null, tweenStart = 0;
let TWEEN_MS = 450, tweenDur = 450;

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
  // 輪切り図で見る指を選ぶボタン（押さえる指だけ）
  const el = document.getElementById('steps');
  const list = [...new Set(chord.fingers.filter(Boolean))].sort();
  el.innerHTML = list.map(f=>`<button data-f="${f}" style="background:${FINGER_COLORS[f]}">${f} ${FINGER_NAMES[f]}</button>`).join('');
  el.querySelectorAll('button').forEach(b=>b.onclick=()=>{ state.focus = +b.dataset.f; markFocus(); kick(); });
  state.focus = list.length ? list[0] : 0;
  markFocus();

  // コツ
  const tips = [];
  if(!list.length) tips.push('<strong>どこも押さえない</strong>コードです。左手は軽くネックに添えるだけでOK。');
  if(chord.barre) tips.push('<strong>セーハ：</strong>人差し指をまっすぐ伸ばし、指の腹より少し親指側（骨の硬いところ）で押さえると音が出やすいです。親指はネックの裏でしっかり支えます。');
  if(list.length && !chord.barre) tips.push('<strong>指を立てる：</strong>第一関節を曲げて、指先で真上から押さえると、となりの弦に触れずにきれいに鳴ります。');
  if(list.length) tips.push('<strong>フレットのすぐ近く：</strong>金属の棒（フレット）のすぐ左側を押さえると、弱い力でもビビりません。');
  const fingersUsed = new Set(chord.fingers.filter(Boolean)).size;
  if(fingersUsed>=3) tips.push('<strong>置く順番：</strong>遠い弦（4弦側）を押さえる指から先に置くと、手の形が作りやすいです。');
  tips.push('<strong>確認：</strong>1本ずつ弾いて、こもった音の弦がないかチェックしましょう。');
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
  document.querySelectorAll('#steps button').forEach(b=>b.classList.toggle('focus', +b.dataset.f===state.focus));
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
  if(animate && poseTo){ poseFrom = currentPose(now); tweenStart = now; tweenDur = TWEEN_MS; }
  else poseFrom = null;
  poseTo = next; window.__pose = next;
  kick();
}
function currentPose(now){
  if(!poseFrom) return poseTo;
  const t = Math.min(1, (now-tweenStart)/tweenDur);
  if(t>=1){ poseFrom = null; return poseTo; }
  return blendPose(poseFrom, poseTo, t);
}
window.setChord = setChord; window.__strumState = strumState;
// コードのボタンを押した時：手がすばやく次の形になり、押さえ終わると同時にジャラーンと鳴る
function pickChord(name){
  if(prog.running || song.running){ return; }              // 練習・曲デモの演奏中はコードを変えない
  TWEEN_MS = 160;
  setChord(name);
  TWEEN_MS = 450;
  strum(getChord(name));
}
function splitName(name){
  const R = ROOTS.map(r=>r.id).sort((a,b)=>b.length-a.length).find(r=>name.startsWith(r));
  return [R, name.slice(R.length)];
}

const rootRow = document.getElementById('rootRow'), typeRow = document.getElementById('typeRow');
ROOTS.forEach(r=>{
  const b = document.createElement('button'); b.className='root-btn'; b.textContent=r.id; b.dataset.root=r.id;
  b.onclick = ()=>{ const t = getChord(r.id+state.type) ? state.type : ''; pickChord(r.id+t); };
  rootRow.appendChild(b);
});
TYPES.forEach(t=>{
  const b = document.createElement('button'); b.textContent=t.label; b.dataset.type=t.id;
  b.onclick = ()=>pickChord(state.root+t.id);
  typeRow.appendChild(b);
});
function updateButtons(){
  rootRow.querySelectorAll('button').forEach(b=>b.classList.toggle('on', b.dataset.root===state.root));
  typeRow.querySelectorAll('button').forEach(b=>{
    b.classList.toggle('on', b.dataset.type===state.type);
    b.disabled = !getChord(state.root+b.dataset.type);
  });
}

function toggleBtn(id, key){
  const b = document.getElementById(id);
  b.onclick = ()=>{ state[key] = !state[key]; b.classList.toggle('on', state[key]); kick(); };
}
toggleBtn('btnBadges','badges');
toggleBtn('btnGhost','ghost');
// 右手の表示：いつも／演奏中だけ／なし
// 速さ（スロー再生）：テンポに掛け算する。演奏中に変えても途切れないようにつなぐ
toggleBtn('btnMirror','mirror');
// ボタンの切り替え（ひとつだけ選べるグループ）
function segment(id, fn){
  const el = document.getElementById(id);
  el.querySelectorAll('button').forEach(b=>b.onclick = ()=>{
    el.querySelectorAll('button').forEach(x=>x.classList.toggle('on', x===b));
    fn(b.dataset.v); kick();
  });
}
// アングル：押すたびに次の向きへ
const ANGLES = ['diag','self','front','side','right','both'];
let angle1 = 'diag', angle2 = 'front';
const nextAngle = a => ANGLES[(ANGLES.indexOf(a)+1) % ANGLES.length];
document.getElementById('angleBtn').onclick = e=>{
  angle1 = nextAngle(angle1); e.currentTarget.textContent = '🎥 ' + VIEWS[angle1].label;
  if(view) view.setView(angle1); kick();
};
document.getElementById('angle2Btn').onclick = e=>{
  angle2 = nextAngle(angle2); e.currentTarget.textContent = '🎥 ' + VIEWS[angle2].label;
  if(view) view.setView2(angle2); kick();
};
// 右手：押すたびに 表示 → 演奏中だけ → 表示しない
const RMODES = [['always','表示'],['playing','演奏中だけ'],['off','なし']];
document.getElementById('rightBtn').onclick = e=>{
  const i = (RMODES.findIndex(m=>m[0]===state.rightMode)+1) % RMODES.length;
  state.rightMode = RMODES[i][0];
  e.currentTarget.textContent = '✋ 右手：' + RMODES[i][1];
  e.currentTarget.classList.toggle('on', state.rightMode !== 'off');
  kick();
};
document.getElementById('btnSplit').onclick = e=>{
  state.split = !state.split;
  e.currentTarget.classList.toggle('on', state.split);
  document.getElementById('angle2Btn').hidden = !state.split;
  document.getElementById('handView').classList.toggle('split', state.split);
  document.getElementById('mainWrap').classList.toggle('split', state.split);
  if(view) view.setSplit(state.split);
  kick();
};
// 速さ（練習・曲デモ）：押すたびに ×1 → ×¾ → ×½ → ×¼
const SPEEDS = [[1,'×1'],[0.75,'×¾'],[0.5,'×½'],[0.25,'×¼']];
document.querySelectorAll('.speedBtn').forEach(b=>b.onclick = ()=>{
  const i = (SPEEDS.findIndex(x=>x[0]===state.speed)+1) % SPEEDS.length;
  state.speed = SPEEDS[i][0];
  document.querySelectorAll('.speedBtn').forEach(x=>{ x.textContent = '速さ ' + SPEEDS[i][1]; x.classList.toggle('on', state.speed !== 1); });
  retime(prog, +bpmEl.value); retime(song, +songBpm.value);
});
document.querySelectorAll('.swingBtn').forEach(b=>b.onclick = ()=>{
  state.swing = !state.swing;
  document.querySelectorAll('.swingBtn').forEach(x=>x.classList.toggle('on', state.swing));
});
// タブ（押さえ方／練習／曲デモ）
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick = ()=>{
  document.querySelectorAll('[data-tab]').forEach(x=>x.classList.toggle('on', x===b));
  document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('on', t.id === 'tab-'+b.dataset.tab));
  kick();
});

/* ---------- 共通の時計 ----------
   音は Web Audio の時計で予約して鳴らす。画面もその時計（＋スピーカーから実際に聞こえるまでの遅れ）
   に合わせて動かすので、音と手の動きがずれない */
const eighth = bpm => 30/(bpm*state.speed);                 // 8分音符1つの長さ（秒）
let lastHeard = -1e9;
function heardTime(){
  let t;
  const ts = actx.getOutputTimestamp ? actx.getOutputTimestamp() : null;
  if(ts && ts.performanceTime > 0) t = ts.contextTime + (performance.now() - ts.performanceTime)/1000;
  else t = actx.currentTime - (actx.outputLatency || actx.baseLatency || 0);
  if(t < lastHeard) t = lastHeard;                          // 時計が戻らないように
  return (lastHeard = t);
}
/* スイング：「タッ・カ・タッ・カ」の、裏の8分音符を少し遅らせる。
   u = まっすぐなリズムでの位置（8分音符単位）、warp(u) = スイングした時の時間の位置 */
const HAND_LEAD_L = 0.12, HAND_LEAD_R = 0.04;                 // 手を音より先に動かす秒数
const SWING = 0.64;                                          // 1拍の中で裏拍が来る位置（0.5=まっすぐ、0.667=3連符）
const swingR = () => state.swing ? SWING : 0.5;
function warp(u){ const b = Math.floor(u/2), f = u/2 - b, r = swingR();
  return 2*(b + (f < 0.5 ? f*2*r : r + (f-0.5)*2*(1-r))); }
function unwarp(x){ const b = Math.floor(x/2), f = x/2 - b, r = swingR();
  return 2*b + (f < r ? f/r : 1 + (f-r)/(1-r)); }
const slotTime = (o, k) => o.t0 + warp(k)*o.e8;             // k番目の8分音符が鳴る時刻
function retime(o, bpm){                                    // テンポ・速さを変えても、今の位置から続ける
  if(!o.running || !actx) return;
  const ct = actx.currentTime, ph = (ct - o.t0)/o.e8, e8 = eighth(bpm);
  o.t0 = ct - ph*e8; o.e8 = e8;
}

/* ---------- 進行練習 ---------- */
const prog = {idx:0, running:false, list:PROGRESSIONS[0].chords, pos:0, timer:null, t0:0, e8:0.5, nextSlot:0, pat:2, hl:null};
const progSel = document.getElementById('progSel'), progChords = document.getElementById('progChords');
progSel.innerHTML = PROGRESSIONS.map((p,i)=>`<option value="${i}">${p.name}（${p.chords.join('→')}）</option>`).join('');
progSel.onchange = ()=>{ const i = +progSel.value; prog.idx=i; prog.list=PROGRESSIONS[i].chords; prog.pos=0; stopProg(); renderProg(); setChord(prog.list[0]); };
const patSel = document.getElementById('patSel');
patSel.innerHTML = PATTERNS.map((p,i)=>`<option value="${i}">${p.name}</option>`).join('');
patSel.value = 2;
patSel.onchange = ()=>{ prog.pat = +patSel.value; renderProg(); kick(); };
function renderProg(){
  progChords.innerHTML = prog.list.map((c,i)=>`<div class="pc" data-i="${i}">${c}</div>`).join('');
  progChords.querySelectorAll('.pc').forEach(el=>el.onclick=()=>{ if(prog.running) return; prog.pos=+el.dataset.i; setChord(prog.list[prog.pos]); });
  // ストロークの譜面（↓↑）
  const P = PATTERNS[prog.pat];
  document.getElementById('patView').innerHTML = [...P.p].map((c,i)=>{
    const cnt = i%2===0 ? (i/2+1) : 'と';
    return `<div class="st${c==='-'?' ghost':''}"><b>${c==='D'?'↓':c==='U'?'↑':'・'}</b><small>${cnt}</small></div>`;
  }).join('');
  document.getElementById('patTip').textContent = P.tip;
  prog.hl = null; highlightProg(-1, -1);
}
// 光らせる場所だけ切り替える（毎回作り直さないので軽い）
function highlightProg(pos, slot){
  const key = pos+':'+slot;
  if(prog.hl === key) return; prog.hl = key;
  const beat = slot < 0 ? -1 : slot>>1, next = (pos+1) % prog.list.length;
  progChords.querySelectorAll('.pc').forEach((el,i)=>{ el.classList.toggle('now', i===pos); el.classList.toggle('next', beat===3 && i===next); });
  document.querySelectorAll('#beats .beat').forEach((el,i)=>el.classList.toggle('on', i===beat));
  document.querySelectorAll('#patView .st').forEach((el,i)=>el.classList.toggle('on', i===slot));
}
const bpmEl = document.getElementById('bpm');
bpmEl.oninput = ()=>{
  document.getElementById('bpmVal').textContent = bpmEl.value;
  retime(prog, +bpmEl.value);             // 演奏中にテンポを変えても、手の振りがつながるように
};
// 8分音符ごとに、音と表示を少し先まで予約する
function tickProg(){
  if(!prog.running) return;
  const P = PATTERNS[prog.pat].p;
  while(slotTime(prog, prog.nextSlot) < actx.currentTime + 0.12){
    const k = prog.nextSlot, when = slotTime(prog, k), slot = k%8;
    const pos = (prog.pos + Math.floor(k/8)) % prog.list.length;
    const chord = getChord(prog.list[pos]);
    if(slot%2===0) click(when, slot===0);
    const c = P[slot];
    if(c==='D') playStroke(chord, 'D', when, slot===0 ? 0.34 : 0.28);
    if(c==='U') playStroke(chord, 'U', when, 0.17);
    prog.nextSlot++;
  }
}
function startProg(){
  ensureAudio(); if(song.running) stopSong();
  if(view) for(const c of prog.list) computePose(getChord(c), view.rig);   // 手の形を先に計算
  shownChord = '';
  prog.running = true;
  prog.e8 = eighth(+bpmEl.value);
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
  highlightProg(-1,-1); setChord(prog.list[prog.pos], false);
}
document.getElementById('btnProg').onclick = ()=> prog.running ? stopProg() : startProg();

/* ---------- 演奏デモ（曲） ---------- */
const song = {idx:0, running:false, timer:null, t0:0, e8:0.3, nextSlot:0, mel:0, notes:[], melodyOn:true, hl:null};
const SONG = () => SONGS[song.idx];
const songList = document.getElementById('songList'), songSheet = document.getElementById('songSheet');
SONGS.forEach((sg,i)=>{
  const b = document.createElement('button'); b.className = 'chip'; b.textContent = sg.short || sg.title;
  b.onclick = ()=>{ stopSong(); song.idx = i; songBpm.value = sg.bpm; document.getElementById('songBpmVal').textContent = sg.bpm; renderSong(); setChord(sg.bars[0][0][0]); };
  songList.appendChild(b);
});
const songBpm = document.getElementById('songBpm');
songBpm.oninput = ()=>{
  document.getElementById('songBpmVal').textContent = songBpm.value;
  retime(song, +songBpm.value);
};
document.getElementById('btnMelody').onclick = e=>{ song.melodyOn = !song.melodyOn; e.currentTarget.classList.toggle('on', song.melodyOn); };
function renderSong(){
  const sg = SONG();
  songList.querySelectorAll('button').forEach((b,i)=>b.classList.toggle('on', i===song.idx));
  document.getElementById('songInfo').innerHTML =
    `<b>${sg.title}</b><span>${sg.credit}</span><span>キー：${sg.key}・${sg.beats}拍子・右手 ${[...sg.pattern].map(c=>c==='D'?'↓':c==='U'?'↑':'・').join('')}</span><span>${sg.note}</span>` +
    ((sg.melody || sg.score) ? '' : '<span class="muted">※この曲は伴奏（コードとストローク）だけのデモです</span>');
  document.getElementById('btnMelody').style.display = (sg.melody || sg.score) ? '' : 'none';
  songSheet.innerHTML = sg.bars.map(b=>`<div class="bar">${b.map(c=>`<span>${c[0]}</span>`).join('')}</div>`).join('');
  song.hl = null; highlightSong(-1);
}
function highlightSong(bar){
  if(song.hl === bar) return; song.hl = bar;
  songSheet.querySelectorAll('.bar').forEach((el,i)=>el.classList.toggle('now', i===bar));
}
function chordAt(sg, k){
  const spb = sg.beats*2, bar = Math.floor(k/spb), beat = (k%spb)/2;
  let acc = 0;
  for(const [c, n] of sg.bars[bar]){ if(beat < acc + n) return c; acc += n; }
  return sg.bars[bar][sg.bars[bar].length-1][0];
}
// オルゴールのような音（チンと鳴って、ゆっくり消える）
function playBell(midi, when){
  const f = 440*Math.pow(2,(midi-69)/12), g = actx.createGain();
  g.gain.setValueAtTime(0.0001, when); g.gain.exponentialRampToValueAtTime(0.06, when+0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, when+1.6);
  for(const [mult, v] of [[1,1],[3.01,0.18],[5.2,0.05]]){
    const o = actx.createOscillator(), og = actx.createGain(); o.type = 'sine'; o.frequency.value = f*mult; og.gain.value = v;
    o.connect(og); og.connect(g); o.start(when); o.stop(when+1.7);
  }
  g.connect(actx.destination);
}
function playNote(midi, when, dur){
  const f = 440*Math.pow(2,(midi-69)/12);
  const g = actx.createGain(), lp = actx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 2600;
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(0.11, when+0.03);
  g.gain.exponentialRampToValueAtTime(0.07, when+0.15);
  g.gain.setValueAtTime(0.07, when+Math.max(0.16, dur-0.08));
  g.gain.exponentialRampToValueAtTime(0.0001, when+dur+0.05);
  for(const [type, mult, v] of [['triangle',1,1],['sine',2,0.25]]){
    const o = actx.createOscillator(), og = actx.createGain();
    o.type = type; o.frequency.value = f*mult; og.gain.value = v;
    // ほんの少しビブラート
    const lfo = actx.createOscillator(), lg = actx.createGain(); lfo.frequency.value = 5.2; lg.gain.value = f*mult*0.004;
    lfo.connect(lg); lg.connect(o.frequency); lfo.start(when); lfo.stop(when+dur+0.1);
    o.connect(og); og.connect(g); o.start(when); o.stop(when+dur+0.1);
  }
  g.connect(lp); lp.connect(actx.destination);
}
function tickSong(){
  if(!song.running || song.running === 'ending') return;
  const sg = SONG(), spb = sg.beats*2, total = sg.bars.length*spb;
  const ahead = actx.currentTime + 0.12;
  // メロディ
  const nt = b => slotTime(song, b*2);                       // 拍 → 時刻（スイングも反映）
  while(song.melodyOn && song.mel < song.notes.length && nt(song.notes[song.mel].beat) < ahead){
    const n = song.notes[song.mel++];
    if(n.midi != null){ const a = nt(n.beat); if(n.bell) playBell(n.midi, a); else playNote(n.midi, a, (nt(n.beat+n.len)-a)*0.95); }
  }
  if(!song.melodyOn) while(song.mel < song.notes.length && nt(song.notes[song.mel].beat) < ahead) song.mel++;
  // 伴奏
  while(slotTime(song, song.nextSlot) < ahead){
    const k = song.nextSlot, when = slotTime(song, k);
    const delay = Math.max(0,(when-actx.currentTime)*1000);
    song.nextSlot++;
    if(k < 0){                                   // カウント（1小節）
      if((k & 1) === 0) click(when, k === -spb);
      continue;
    }
    if(k >= total){                              // おしまい
      setTimeout(()=>stopSong(), delay + 600);
      song.running = 'ending';
      return;
    }
    const slot = k % spb, bar = Math.floor(k/spb), last = bar === sg.bars.length-1;
    const c = chordAt(sg, k);
    const st = last ? (slot===0 ? 'D' : '-') : sg.pattern[slot];
    const chord = getChord(c);
    if(st==='D') playStroke(chord, 'D', when, slot===0 ? 0.30 : 0.24);
    if(st==='U') playStroke(chord, 'U', when, 0.15);
  }
}
function startSong(){
  ensureAudio(); stopProg();
  const sg = SONG();
  // 曲で使うコードの手の形を先に全部計算しておく（演奏中に引っかからないように）
  if(view) for(const b of sg.bars) for(const [c] of b) computePose(getChord(c), view.rig);
  shownChord = '';
  song.e8 = eighth(+songBpm.value);
  const cin = sg.beats*2;
  song.t0 = actx.currentTime + 0.3 + cin*song.e8;     // 1小節目の頭（その前に1小節カウント）
  song.nextSlot = -cin;
  // メロディの開始位置（拍）
  let b = -(sg.pickup||0); song.notes = []; song.mel = 0;
  if(sg.melody) for(const [midi, len] of sg.melody){ song.notes.push({midi, beat:b, len}); b += len; }
  if(sg.score){ for(const [midi, beat] of sg.score) song.notes.push({midi, beat, len:1, bell:true}); song.notes.sort((x,y)=>x.beat-y.beat); }
  song.running = true;
  setChord(sg.bars[0][0][0]);
  document.getElementById('btnSong').textContent = '■ ストップ';
  song.timer = setInterval(tickSong, 25);
  tickSong(); kick();
}
function stopSong(){
  song.running = false; clearInterval(song.timer);
  document.getElementById('btnSong').textContent = '▶ 演奏する';
  highlightSong(-1); kick();
}
document.getElementById('btnSong').onclick = ()=> song.running ? stopSong() : startSong();
renderSong();

/* ---------- いま演奏しているもの（練習 or 曲）を同じ形で扱う ---------- */
function playing(){
  if(prog.running) return {o:prog, pattern:PATTERNS[prog.pat].p, end:Infinity, spb:8,
    chordAt: k => prog.list[(prog.pos + Math.floor(Math.max(0,k)/8)) % prog.list.length]};
  if(song.running){ const sg = SONG(), spb = sg.beats*2, total = sg.bars.length*spb;
    return {o:song, pattern:sg.pattern, end:total, spb,
      chordAt: k => chordAt(sg, Math.min(total-1, Math.max(0, k)))}; }
  return null;
}
/* 左手：音楽の時計から「今どのコードか」「次のコードへどこまで動いたか」を決める。
   次のコードの音が鳴る瞬間にちょうど押さえ終わるように、少し前から動き始める */
let shownChord = '';
function musicPose(pl, ph){
  const k = Math.floor(ph), cur = pl.chordAt(k);
  if(cur !== shownChord){ shownChord = cur; setChord(cur, false); }
  let pose = computePose(getChord(cur), view.rig);
  for(let j = k+1; j <= k+pl.spb && j < pl.end; j++){
    const nx = pl.chordAt(j);
    if(nx === cur) continue;
    const left = (warp(j) - warp(ph))*pl.o.e8;              // 次のコードまでの秒数
    const dur = Math.min(0.32, pl.o.e8*2*0.9);              // 動かす時間（最大でも1拍弱）
    if(left < dur){
      const t = 1 - left/dur;
      pose = blendPose(pose, computePose(getChord(nx), view.rig), t);
    }
    break;
  }
  return pose;
}

// 右手の今の状態（振りの角度・浮かせる量）
const REST = {theta: -STRUM_AMP, lift: 7, wrist: 4, roll: 0, flick: -4};
function rightState(now, pl, ph){
  if(pl){
    if(ph < -0.5) return idleState(now/1000);
    if(pl.end !== Infinity && ph > pl.end - pl.spb + 0.6) return {theta: STRUM_AMP*1.1, lift: 6, wrist: -10, roll: 6, flick: 6};   // 最後のジャーンのあと
    return strumState(ph, pl.pattern);
  }
  if(oneShot){
    const t = (now - oneShot.start)/state.speed;
    if(t < ONE_DOWN){ const u = t/ONE_DOWN; return {...strumState(u-0.5, 'D-'), lift: 0}; }
    if(t < ONE_DOWN+ONE_BACK){ const u = (t-ONE_DOWN)/ONE_BACK, e = (1-Math.cos(Math.PI*u))/2;
      return {theta: STRUM_AMP*(1-2*e), lift: 7*Math.sin(Math.PI*Math.min(1,u*1.3)), wrist: -10*(1-2*e), roll: 6*(1-2*e), flick: -6*Math.sin(Math.PI*u)}; }
    oneShot = null;
  }
  return idleState(now/1000);
}

/* ---------- 描画ループ（動いている時だけ描き直す） ---------- */
let dirty = true, raf = 0;
function kick(){ dirty = true; if(!raf) raf = requestAnimationFrame(loop); }
// 動きをなめらかにする工夫
//  ・右手の動きは少しだけ「ならす」（急に止まったり跳んだりしない）
//  ・輪切り図は、手が止まった時だけ描き直す
//  ・重い端末では、動いている間だけ自動で解像度を下げる
let rSmooth = null, lastFrame = 0, frameAvg = 16, quality = 1, wasMoving = false;
function smoothRight(target, now){
  if(!target){ rSmooth = null; return null; }
  if(!rSmooth){ rSmooth = {...target}; return rSmooth; }
  const dt = Math.min(0.1, Math.max(0, (now - (rSmooth.t||now))/1000));
  const k = 1 - Math.exp(-dt/0.018);
  for(const key of ['theta','lift','wrist','roll','flick']) rSmooth[key] = (rSmooth[key] ?? 0) + ((target[key] ?? 0) - (rSmooth[key] ?? 0))*k;
  rSmooth.t = now;
  return {theta: rSmooth.theta, lift: rSmooth.lift, wrist: rSmooth.wrist, roll: rSmooth.roll, flick: rSmooth.flick};
}
function loop(now){
  raf = 0;
  if(!view || !poseTo) return;
  const pl = playing();
  // 手の動きは音より少しだけ先に（目で見て準備できるように）：左手0.12秒・右手0.04秒
  const tNow = pl ? heardTime() - pl.o.t0 : 0;
  const ph  = pl ? unwarp(tNow/pl.o.e8) : 0;                       // 今どの8分音符か（スイングを戻して数える）
  const phL = pl ? unwarp((tNow + HAND_LEAD_L)/pl.o.e8) : 0;
  const phR = pl ? unwarp((tNow + HAND_LEAD_R)/pl.o.e8) : 0;
  const handMoving = !!poseFrom;
  const active = !!pl || !!oneShot;
  const showRight = state.rightMode === 'always' || (state.rightMode === 'playing' && active);
  const moving = handMoving || active;
  if(moving && wasMoving){
    frameAvg = frameAvg*0.9 + Math.min(100, now - lastFrame)*0.1;
    if(frameAvg > 24 && quality > 0.5) { quality = Math.max(0.5, quality - 0.1); frameAvg = 16; }
    else if(frameAvg < 17.5 && quality < 1) quality = Math.min(1, quality + 0.02);
  }
  lastFrame = now;
  if(!moving && wasMoving){ quality = 1; dirty = true; }   // 止まったらきれいに描き直す
  if(dirty || moving){
    let pose;
    if(pl){
      pose = musicPose(pl, phL);
      if(pl.o === prog) highlightProg(ph < 0 ? -1 : (prog.pos + Math.floor(ph/8)) % prog.list.length, ph < 0 ? -1 : Math.floor(ph) % 8);
      else highlightSong(ph < 0 || ph >= pl.end ? -1 : Math.floor(ph/pl.spb));
    } else pose = currentPose(now);
    const settle = handMoving && !poseFrom;                // 左手の動きがちょうど終わった
    const right = window.__forceRight || smoothRight(showRight ? rightState(now, pl, phR) : null, now);
    view.render(pose, {...state, right, quality: moving ? quality : 1,
      skipSide: pl ? true : handMoving ? !settle : !dirty});
    dirty = false;
  }
  wasMoving = moving;
  if((moving || poseFrom) && !raf) raf = requestAnimationFrame(loop);
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
  // 練習・演奏デモで使うコードを先に
  const first = new Set([...SONGS.flatMap(sg=>sg.bars.flat().map(c=>c[0])), ...PROGRESSIONS.flatMap(p=>p.chords)]);
  const rest = [...first, ...Object.keys(CHORDS).filter(c=>!first.has(c))];
  const idle = window.requestIdleCallback || (fn=>setTimeout(()=>fn({timeRemaining:()=>8}), 30));
  const work = dl => { while(rest.length && dl.timeRemaining() > 4) computePose(getChord(rest.shift()), view.rig); if(rest.length) idle(work); };
  idle(work);
}).catch(err=>{
  console.error(err);
  document.getElementById('mainWrap').innerHTML = '<p style="padding:30px;color:#c9b6a3">この端末では3D表示が使えません（WebGLが無効です）。</p>';
});
