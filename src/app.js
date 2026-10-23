/* =========================================================
   ギター・ハンドガイド（画面の操作・音・説明）
   ========================================================= */
import { STRING_NAMES, STRING_NUM, STRING_MIDI, FINGER_NAMES, FINGER_COLORS, ROOTS, TYPES, getChord, resolveChord, PROGRESSIONS, CHORDS, SONGS, TAB_SONGS } from './data.js';
import { parseChordSheet, cleanTitle, bookmarkletCode } from './chordsheet.js';
import { computePose, computeTabPose, blendPose, blendTab, HAND_CFG, clearPoseCache } from './pose.js';
window.__cfg = HAND_CFG;
import { createView, VIEWS } from './view.js';
import { BACKDROPS } from './backdrop.js';
import { FINISHES } from './guitar.js';
import { GUITARS, NSTR, strY, STRUM_X } from './geom.js';
import { parseCompact, parseTabText, parseMidi, parseMusicXML, readMxl, eventChord, eventPressed, noteName, fingerPlan } from './tab.js';
import { PATTERNS, strumState, idleState, STRUM_AMP } from './strum.js';

const state = {root:'C', type:'', mirror:false, badges:true, ghost:true, rightMode:'always', speed:1, swing:false, split:false,
               bg:'day', capo:0, guitar:'acoustic', finishes:{acoustic:'natural', electric:'sunburst', lespaul:'cherry'}, chart:true, leftHand:true};
// 設定は次に開いた時も同じになるように覚えておく（覚えられない端末ではそのまま）
const SAVED = ['mirror','badges','ghost','rightMode','split','bg','guitar','finishes','chart','leftHand','capo','cam'];
try{ const sv = JSON.parse(localStorage.getItem('guitarSettings') || '{}'); for(const k of SAVED) if(k in sv) state[k] = sv[k]; }catch(e){}
const saveSettings = () => { try{ localStorage.setItem('guitarSettings', JSON.stringify(Object.fromEntries(SAVED.map(k=>[k, state[k]])))); }catch(e){} };
let view = null, rig = null;
let poseFrom = null, poseTo = null, tweenStart = 0;
let TWEEN_MS = 450, tweenDur = 450;

/* =========================================================
   カポ：コードの押さえ方（形）はそのまま、カポの分だけ上のフレットで押さえる。音もカポの分だけ高くなる
   ・押さえるフレット：f → f＋カポ（0＝開放弦はカポが押さえる）
   ・コード名は押さえ方の名前のまま。実際に鳴る音の名前は別に出す
   ========================================================= */
const capo = () => state.capo || 0;
function shiftChord(c){
  const k = capo(); if(!k || !c) return c;
  return {...c, name: c.name + '@capo' + k, frets: c.frets.map(f => f > 0 ? f + k : f),
          barre: c.barre ? {...c.barre, fret: c.barre.fret + k} : null};
}
const chordPose = name => computePose(shiftChord(typeof name === 'string' ? getChord(name) : name), view.rig);
const SEMI = {'C':0,'D':2,'E♭':3,'E':4,'F':5,'G':7,'A':9,'B♭':10,'B':11};
const NOTE_NM = ['C','C♯','D','E♭','E','F','F♯','G','A♭','A','B♭','B'];
function soundingName(name){
  const [root, type] = splitName(name);
  return NOTE_NM[(SEMI[root] + capo()) % 12] + type;
}

/* =========================================================
   縦のコード表
   ========================================================= */
function diagramSVG(chord){
  const L=22, T=40, W=106, H=150, cols=NSTR, rows=5;
  // 高いフレットのコードは、いちばん低い押さえる所を表の1段目にして「4fr」のように書く
  const pressed = chord.frets.filter(f=>f>0), base = pressed.length && Math.max(...pressed) > rows ? Math.min(...pressed) : 1;
  const sx = i => L + i*W/(cols-1), sy = j => T + j*H/rows, row = fr => fr - base + 1;
  let s = `<rect width="150" height="210" rx="10" fill="#faf8f3"/>`;
  if(base > 1) s += `<text x="${L-4}" y="${(sy(0)+sy(1))/2+4}" text-anchor="end" font-size="10" font-weight="700" fill="#555">${base}fr</text>`;
  s += `<text x="75" y="26" text-anchor="middle" font-size="24" font-weight="800" fill="#1b1410">${chord.name}</text>`;
  if(capo()) s += `<text x="146" y="14" text-anchor="end" font-size="11" font-weight="700" fill="#0e9f9a">カポ${capo()}</text>`;
  for(let j=0;j<=rows;j++) s += `<line x1="${L}" x2="${L+W}" y1="${sy(j)}" y2="${sy(j)}" stroke="#555" stroke-width="${j || base > 1 ? 1.4 : 5}"/>`;
  for(let i=0;i<cols;i++){
    s += `<line x1="${sx(i)}" x2="${sx(i)}" y1="${T}" y2="${T+H}" stroke="#333" stroke-width="1.6"/>`;
    s += `<text x="${sx(i)}" y="${T+H+16}" text-anchor="middle" font-size="11" fill="#555">${STRING_NAMES[i]}</text>`;
    if(chord.frets[i]===0) s += `<circle cx="${sx(i)}" cy="${T-10}" r="5" fill="none" stroke="#333" stroke-width="1.6"/>`;
    if(chord.frets[i]<0) s += `<path d="M${sx(i)-4.5} ${T-14.5}l9 9m0 -9l-9 9" stroke="#333" stroke-width="1.8"/>`;
  }
  if(chord.barre){
    const b = chord.barre, y = (sy(row(b.fret)-1)+sy(row(b.fret)))/2;
    s += `<rect x="${sx(b.from)-9}" y="${y-9}" width="${sx(b.to)-sx(b.from)+18}" height="18" rx="9" fill="${FINGER_COLORS[1]}"/>`;
  }
  chord.frets.forEach((fr,i)=>{
    if(!(fr > 0)) return;
    const f = chord.fingers[i];
    if(chord.barre && f===1 && fr===chord.barre.fret) {
      s += `<text x="${sx(i)}" y="${(sy(row(fr)-1)+sy(row(fr)))/2+4.5}" text-anchor="middle" font-size="12" font-weight="800" fill="#1b1410">1</text>`;
      return;
    }
    const y = (sy(row(fr)-1)+sy(row(fr)))/2;
    s += `<circle cx="${sx(i)}" cy="${y}" r="9.5" fill="${FINGER_COLORS[f]}" stroke="#1b1410" stroke-width="1.2"/>`;
    s += `<text x="${sx(i)}" y="${y+4.5}" text-anchor="middle" font-size="12" font-weight="800" fill="#1b1410">${f}</text>`;
  });
  return `<svg viewBox="0 0 150 210" aria-label="${chord.name}のコード表">${s}</svg>`;
}
/* 3D画面の左下：いまのコード（演奏中は「いま → 次 → その次」） */
const chordCard = document.getElementById('chordCard'), svgCache = {};
let stripKey = '';
function showStrip(names, soon=false){
  const key = names.join(',') + (soon ? '!' : '');
  if(key === stripKey) return; stripKey = key;
  chordCard.innerHTML = names.map((n,i)=>{
    svgCache[n + '@' + capo()] ||= diagramSVG(getChord(n));
    const cls = 'cc' + (i===0 ? ' now' : '') + (i===1 && soon ? ' soon' : '');
    return (i ? '<b class="arr">→</b>' : '') + `<div class="${cls}">${svgCache[n + '@' + capo()]}</div>`;
  }).join('');
}

/* =========================================================
   音（カープラス・ストロング法でギターっぽい音を合成。アコギは胴鳴り、エレキは少し明るく）
   ========================================================= */
let actx = null, master = null;
const tone = {};
function setTone(){
  if(!actx) return;
  const el = state.guitar !== 'acoustic';
  tone.body.frequency.value = el ? 900 : 120; tone.body.gain.value = el ? 2 : 6;   // アコギは低い胴鳴り
  tone.lp.frequency.value = el ? 4200 : 6500;
}
const bufCache = {};
function ensureAudio(){
  if(!actx){
    actx = new (window.AudioContext||window.webkitAudioContext)();
    master = actx.createGain(); master.gain.value = 0.7;
    tone.body = actx.createBiquadFilter(); tone.body.type='peaking'; tone.body.Q.value=1.1;
    tone.lp = actx.createBiquadFilter(); tone.lp.type='lowpass';
    master.connect(tone.body); tone.body.connect(tone.lp); tone.lp.connect(actx.destination);
    setTone();
  }
  if(actx.state==='suspended') actx.resume();
}
// 決まった乱数
function rng(seed){ return ()=>{ seed=(seed*16807)%2147483647; return (seed-1)/2147483646; }; }
function pluckBuffer(midi){
  if(bufCache[midi]) return bufCache[midi];
  const sr = actx.sampleRate, freq = 440*Math.pow(2,(midi-69)/12);
  const len = Math.floor(sr*3);
  const N = Math.max(2, Math.round(sr/freq - 0.5));
  const buf = actx.createBuffer(1, len, sr), y = buf.getChannelData(0);
  const r = rng(midi*13+5);
  let prev = 0;
  for(let i=0;i<N;i++){ const v = r()*2-1; prev = prev*0.5 + v*0.5; y[i] = prev; }
  const decay = midi < 52 ? 0.998 : 0.9968;          // 低い弦は長く鳴る
  for(let i=N;i<len;i++) y[i] = decay*0.5*(y[i-N] + y[i-N-1 >= 0 ? i-N-1 : 0]);
  // 頭のノイズを少し整える
  let mx = 0; for(let i=0;i<len;i++) mx = Math.max(mx, Math.abs(y[i]));
  for(let i=0;i<len;i++) y[i] /= (mx||1);
  bufCache[midi] = buf; return buf;
}
function playString(si, fret, when, vol){
  const midi = STRING_MIDI[si] + fret + capo();
  const src = actx.createBufferSource(); src.buffer = pluckBuffer(midi);
  const g = actx.createGain();
  g.gain.setValueAtTime(0, when); g.gain.linearRampToValueAtTime(vol, when+0.004);
  g.gain.exponentialRampToValueAtTime(0.0008, when+2.9);
  src.connect(g); g.connect(master); src.start(when); src.stop(when+3);
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
// ダウン（6弦→1弦）／アップ（1弦→6弦。アップは高い方の弦だけ軽く）。×の弦は鳴らさない
function playStroke(chord, dir, when, vol, gap=0.009){
  const list = [];
  for(let k=0;k<NSTR;k++){ const si = dir==='D' ? k : NSTR-1-k; if(chord.frets[si] >= 0 && (dir==='D' || si >= 2)) list.push(si); }
  list.forEach((si,k)=>playString(si, chord.frets[si], when + k*gap, vol*0.8));
}
function arpeggio(chord){
  ensureAudio();
  const t = actx.currentTime + 0.02;
  let k = 0;
  for(let si=0; si<NSTR; si++) if(chord.frets[si] >= 0) playString(si, chord.frets[si], t+(k++)*0.4, 0.4);
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
  document.getElementById('chordReading').textContent = `${R.read}・${T.read}` + (capo() ? `（カポ${capo()}・実際の音は ${soundingName(name)}）` : '');
  if(!playing()) showStrip([name]);
  updateButtons();
  if(!view) return;
  const now = performance.now();
  const next = chordPose(chord);
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
  if(prog.running || song.running || tabs.running){ return; }              // 練習・曲デモの演奏中はコードを変えない
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
/* ---------- 設定（歯車ボタン） ---------- */
const RMODES = [['always','いつも表示'],['playing','演奏中だけ'],['off','表示しない']];
const settingsEl = document.getElementById('settings'), gearBtn = document.getElementById('gearBtn');
function openSettings(on){ settingsEl.hidden = !on; gearBtn.classList.toggle('on', on); }
gearBtn.onclick = e=>{ e.stopPropagation(); openSettings(settingsEl.hidden); };
document.getElementById('setClose').onclick = ()=>openSettings(false);
document.addEventListener('pointerdown', e=>{ if(!settingsEl.hidden && !settingsEl.contains(e.target) && e.target !== gearBtn) openSettings(false); });
// ひとつだけ選ぶボタンの列
function choiceRow(id, items, key, apply){
  const el = document.getElementById(id);
  el.innerHTML = items.map(([v, label, sw])=>`<button data-v="${v}">${sw ? `<i class="sw" style="background:${sw}"></i>` : ''}${label}</button>`).join('');
  const mark = () => el.querySelectorAll('button').forEach(b=>b.classList.toggle('on', b.dataset.v === state[key]));
  el.querySelectorAll('button').forEach(b=>b.onclick = ()=>{ state[key] = b.dataset.v; mark(); apply(); saveSettings(); kick(); });
  mark();
}
const BG_SW = {day:'#7fd3cc', sunset:'#f0805a', night:'#1f2d55', house:'#b0805a', meadow:'#6fa045'};
choiceRow('optBg', Object.entries(BACKDROPS).map(([k,b])=>[k, b.label, BG_SW[k]]), 'bg', ()=>view && view.setBackdrop(state.bg));
// ギターの種類（アコースティック／エレキ）と柄
const FIN_SW = f => f.paint || (f.burst ? 'radial-gradient(#e8b25a 30%,#7a1c08 70%,#1a0804)' : f.top.light);
function finishRow(){
  const list = FINISHES[state.guitar];
  state.finish = list[state.finishes[state.guitar]] ? state.finishes[state.guitar] : Object.keys(list)[0];
  choiceRow('optFinish', Object.entries(list).map(([k,f])=>[k, f.label, FIN_SW(f)]), 'finish', ()=>{
    state.finishes = {...state.finishes, [state.guitar]: state.finish};
    view && view.setFinish(state.finish);
  });
}
function applyGuitar(){
  finishRow();
  setTone();
  if(!view) return;
  view.setGuitar(state.guitar, state.finish);
  clearPoseCache(); poseFrom = null; poseTo = null; tabK = 0;
  setChord(chordName(), false);
}
choiceRow('optGuitar', Object.entries(GUITARS).map(([k,gt])=>[k, gt.label]), 'guitar', ()=>{ if(prog.running) stopProg(); if(song.running) stopSong(); stopTab(); applyGuitar(); });
finishRow();
choiceRow('optRight', RMODES, 'rightMode', ()=>{});
// オン・オフのボタン
const TOGGLES = [['split','▥ 2画面'],['leftHand','左手'],['ghost','半透明'],['badges','指番号'],['mirror','左右反転'],['chart','コード表']];
const showEl = document.getElementById('optShow');
showEl.innerHTML = TOGGLES.map(([k,l])=>`<button data-k="${k}">${l}</button>`).join('');
function applyToggles(){
  showEl.querySelectorAll('button').forEach(b=>b.classList.toggle('on', !!state[b.dataset.k]));
  document.getElementById('angle2Btn').hidden = !state.split;
  document.getElementById('handView').classList.toggle('split', state.split);
  document.getElementById('mainWrap').classList.toggle('split', state.split);
  document.getElementById('chordCard').classList.toggle('off', !state.chart);
  if(view) view.setSplit(state.split);
}
showEl.querySelectorAll('button').forEach(b=>b.onclick = ()=>{ state[b.dataset.k] = !state[b.dataset.k]; applyToggles(); saveSettings(); kick(); });
applyToggles();
// 速さ（練習・曲デモ）：押すたびに ×1 → ×¾ → ×½ → ×¼
const SPEEDS = [[1,'×1'],[0.75,'×¾'],[0.5,'×½'],[0.25,'×¼']];
document.querySelectorAll('.speedBtn').forEach(b=>b.onclick = ()=>{
  const i = (SPEEDS.findIndex(x=>x[0]===state.speed)+1) % SPEEDS.length;
  state.speed = SPEEDS[i][0];
  document.querySelectorAll('.speedBtn').forEach(x=>{ x.textContent = '速さ ' + SPEEDS[i][1]; x.classList.toggle('on', state.speed !== 1); });
  retime(prog, +bpmEl.value); retime(song, +songBpm.value); retimeTab();
});
document.querySelectorAll('.swingBtn').forEach(b=>b.onclick = ()=>{
  state.swing = !state.swing;
  document.querySelectorAll('.swingBtn').forEach(x=>x.classList.toggle('on', state.swing));
});
/* ---------- 全画面：3D画面いっぱいに。コードのボタンと再生ボタンは3D画面の中へ ---------- */
const fsBtn = document.getElementById('fsBtn'), fsBar = document.getElementById('fsBar');
const fsName = document.getElementById('fsName'), fsPlay = document.getElementById('fsPlay');
let fsOn = false;
const activeTab = () => document.querySelector('[data-tab].on')?.dataset.tab || 'practice';
function updateFs(){
  if(!fsOn) return;
  const at = activeTab();
  const run = at === 'practice' ? prog.running : at === 'songs' ? song.running : tabs.running;
  fsName.textContent = at === 'practice' ? '練習：' + prog.list.join('→') : at === 'songs' ? '曲：' + SONG().title : 'ソロ（開発中）：' + TAB().title;
  fsPlay.textContent = run ? '■ ストップ' : '▶ ' + (at === 'practice' ? 'スタート' : '演奏する');
}
function setFS(on){
  fsOn = on;
  document.body.classList.toggle('fs', on);
  if(on) fsBar.append(rootRow, typeRow); else document.querySelector('.side .picker').append(rootRow, typeRow);
  fsBtn.textContent = on ? '✕' : '⛶'; fsBtn.title = on ? '全画面をやめる' : '全画面';
  try{
    if(on && !document.fullscreenElement) document.documentElement.requestFullscreen?.()?.catch?.(()=>{});
    if(!on && document.fullscreenElement) document.exitFullscreen?.();
  }catch(e){}
  updateFs(); kick();
}
fsBtn.onclick = ()=>setFS(!fsOn);
document.addEventListener('fullscreenchange', ()=>{ if(!document.fullscreenElement && fsOn) setFS(false); });
document.addEventListener('keydown', e=>{ if(e.key === 'Escape' && fsOn) setFS(false); });
fsPlay.onclick = ()=>{ document.getElementById({practice:'btnProg', songs:'btnSong', tabs:'btnTab'}[activeTab()]).click(); updateFs(); };
fsName.onclick = ()=>{ document.querySelector(`[data-tab="${{practice:'songs', songs:'tabs', tabs:'practice'}[activeTab()]}"]`).click(); updateFs(); };
// タブ（練習／曲デモ）
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick = ()=>{
  document.querySelectorAll('[data-tab]').forEach(x=>x.classList.toggle('on', x===b));
  document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('on', t.id === 'tab-'+b.dataset.tab));
  if(b.dataset.tab === 'tabs'){ if(!tabs.running) showTabEvent(Math.max(0, tabs.shown), true); }
  else if(!tabs.running && tabs.shown >= 0){ tabs.shown = -1; setChord(chordName(), true); }
  kick(); updateFs();
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
/* 自分で作る進行：コード名をスペース（または → , ・）で区切って書く。1つ＝1小節。
   Bb・A# → B♭、am → Am、M7 → maj7 のような書き方も受け付ける */
const customRow = document.getElementById('customRow'), customIn = document.getElementById('customProg'), customMsg = document.getElementById('customMsg');
let customList = ['C','Am','F','G7'];
try{ const sv = JSON.parse(localStorage.getItem('guitarCustomProg') || 'null'); if(Array.isArray(sv) && sv.length) customList = sv; }catch(e){}
customIn.value = customList.join(' ');
function normChord(t){ const r = resolveChord(t); return r ? r.name : null; }
function readCustom(){
  const toks = customIn.value.split(/[\s,、→\-・|]+/).filter(Boolean);
  const ok = [], bad = [];
  for(const t of toks){ const n = normChord(t); n ? ok.push(n) : bad.push(t); }
  customIn.classList.toggle('bad', bad.length > 0);
  customMsg.classList.toggle('bad', bad.length > 0);
  customMsg.textContent = bad.length ? `使えないコード：${bad.join('、')}（ほかの${ok.length}個で練習します）`
                                     : ok.length ? `${ok.length}小節をくり返します` : 'コードを書いてください';
  if(!ok.length) return;
  customList = ok;
  try{ localStorage.setItem('guitarCustomProg', JSON.stringify(ok)); }catch(e){}
  if(progSel.value === 'custom'){
    prog.list = customList; prog.pos %= ok.length; renderProg();
    if(!prog.running) setChord(prog.list[prog.pos]);
  }
}
customIn.oninput = readCustom;
/* ---------- 取り込んだ曲（コード譜から） ----------
   imported：[{name, chords（書かれていたままのコード名）, capo}]。この端末に残す */
let imported = [];
try{ const sv = JSON.parse(localStorage.getItem('guitarImportedProgs') || '[]'); if(Array.isArray(sv)) imported = sv.filter(x=>x && Array.isArray(x.chords)); }catch(e){}
const saveImported = () => { try{ localStorage.setItem('guitarImportedProgs', JSON.stringify(imported)); }catch(e){} };
const impMsg = document.getElementById('impMsg'), impDel = document.getElementById('impDel');
function buildProgSel(keep){
  progSel.innerHTML = PROGRESSIONS.map((p,i)=>`<option value="${i}">${p.name}（${p.chords.join('→')}）</option>`).join('')
    + (imported.length ? `<optgroup label="取り込んだ曲">` + imported.map((p,i)=>`<option value="imp:${i}">📥 ${p.name}</option>`).join('') + `</optgroup>` : '')
    + `<option value="custom">✏️ 自分で作る</option>`;
  if(keep != null) progSel.value = keep;
}
buildProgSel();
// 書かれていたコード名 → このアプリのコード名。代用した物・読めなかった物も返す
function resolveList(raw){
  const names = [], subs = [], bad = [];
  for(const c of raw){ const r = resolveChord(c); if(!r){ bad.push(c); continue; } names.push(r.name); if(r.sub) subs.push(`${r.sub}→${r.name}`); }
  return {names, subs: [...new Set(subs)], bad: [...new Set(bad)]};
}
function showImpMsg(sg){
  const {subs, bad, names} = resolveList(sg.chords);
  let t = `${names.length}小節` + (sg.capo ? `・カポ${sg.capo}` : '');
  if(subs.length) t += `　代用：${subs.join('、')}`;
  if(bad.length) t += `　読めなかった：${bad.join('、')}`;
  impMsg.textContent = t; impMsg.hidden = false;
}
progSel.onchange = ()=>{
  const custom = progSel.value === 'custom', imp = progSel.value.startsWith('imp:');
  customRow.hidden = !custom; impDel.hidden = !imp; impMsg.hidden = !imp;
  if(imp){
    const sg = imported[+progSel.value.slice(4)];
    prog.list = resolveList(sg.chords).names; showImpMsg(sg);
    if(sg.capo != null && sg.capo !== state.capo){ state.capo = sg.capo; applyCapo(); }
  } else prog.list = custom ? customList : PROGRESSIONS[+progSel.value].chords;
  if(!prog.list.length) prog.list = ['C'];
  prog.idx = progSel.value; prog.pos = 0; stopProg(); renderProg(); setChord(prog.list[0]);
  if(custom){ readCustom(); customIn.focus(); }
};
impDel.onclick = ()=>{
  if(!progSel.value.startsWith('imp:')) return;
  imported.splice(+progSel.value.slice(4), 1); saveImported(); buildProgSel('0'); progSel.onchange();
};
function addImportedProg(sheet, fallbackTitle){
  const {names, bad} = resolveList(sheet.chords);
  if(!names.length) throw new Error(sheet.chords.length ? `コードは見つかりましたが、どれも押さえ方がありません（${bad.slice(0,6).join('、')}）` : 'コードが見つかりませんでした');
  const name = cleanTitle(sheet.title) || fallbackTitle || `取り込んだ曲 ${imported.length + 1}`;
  imported.push({name, chords: sheet.chords, capo: sheet.capo || 0}); saveImported();
  buildProgSel('imp:' + (imported.length - 1));
  document.querySelector('[data-tab="practice"]').click();
  progSel.onchange();
  return name;
}
// アプリのURLの後ろに #import=… が付いていたら（取り込みボタンから開いた時）、その曲を入れる
function importFromHash(){
  const m = location.hash.match(/^#import=(.+)$/); if(!m) return;
  try{
    const d = JSON.parse(decodeURIComponent(m[1]));
    const name = addImportedProg({title: d.t, chords: d.c, capo: d.k}, '取り込んだ曲');
    document.getElementById('impResult').textContent = `「${name}」を取り込みました`;
  }catch(e){ console.error(e); }
  history.replaceState(null, '', location.pathname + location.search);
}
/* 取り込みの画面：取り込みボタン（ブックマークレット）・クリップボード・貼り付け */
{
  const appUrl = location.origin + location.pathname;
  const isWeb = /^https?:/.test(location.protocol);
  const bm = document.getElementById('bmLink'), bmNote = document.getElementById('bmNote'), res = document.getElementById('impResult');
  const code = bookmarkletCode(appUrl);
  bm.href = code;
  bm.onclick = e => { e.preventDefault(); bmNote.hidden = false; bmNote.textContent = 'このボタンは、お気に入りに登録してからコード譜のページで押します（ここで押しても何も起きません）'; };
  if(!isWeb){ bmNote.hidden = false; bmNote.textContent = '取り込みボタンは、ネットで公開したページ（https://…）で開いた時に使えます。'; }
  document.getElementById('bmCopy').onclick = async ()=>{
    try{ await navigator.clipboard.writeText(code); bmNote.hidden = false; bmNote.textContent = 'コピーしました。ブックマークのURLに貼り付けてください'; }
    catch(e){ prompt('このコードをコピーして、ブックマークのURLに貼り付けてください', code); }
  };
  const fail = e => { res.className = 'msg bad'; res.textContent = '取り込めませんでした：' + (e.message || e); };
  const take = (text, title) => {
    try{ const name = addImportedProg(parseChordSheet(text), title); res.className = 'msg ok'; res.textContent = `「${name}」を取り込みました`; }
    catch(e){ fail(e); }
  };
  document.getElementById('impClip').onclick = async ()=>{
    try{
      if(!navigator.clipboard?.readText) throw new Error('この画面ではクリップボードを読めません。下の欄に貼り付けてください');
      const text = await navigator.clipboard.readText();
      if(!text.trim()) throw new Error('クリップボードが空です。コード譜をコピーしてから押してください');
      take(text, document.getElementById('impName').value.trim());
    }catch(e){ fail(e); }
  };
  document.getElementById('impGo').onclick = ()=> take(document.getElementById('impPaste').value, document.getElementById('impName').value.trim());
}
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
  ensureAudio(); if(song.running) stopSong(); stopTab();
  if(view) for(const c of prog.list) chordPose(c);   // 手の形を先に計算
  shownChord = '';
  prog.running = true;
  prog.e8 = eighth(+bpmEl.value);
  prog.t0 = actx.currentTime + 0.45; prog.nextSlot = 0;
  setChord(prog.list[prog.pos]);
  document.getElementById('btnProg').textContent = '■ ストップ';
  prog.timer = setInterval(tickProg, 25);
  tickProg(); kick();
  updateFs();
}
function stopProg(){
  if(prog.running) prog.pos = (prog.pos + Math.floor(Math.max(0,prog.nextSlot-1)/8)) % prog.list.length;
  prog.running = false; clearInterval(prog.timer);
  document.getElementById('btnProg').textContent = '▶ スタート';
  highlightProg(-1,-1); setChord(prog.list[prog.pos], false);
  updateFs();
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
  ensureAudio(); stopProg(); stopTab();
  const sg = SONG();
  // 曲で使うコードの手の形を先に全部計算しておく（演奏中に引っかからないように）
  if(view) for(const b of sg.bars) for(const [c] of b) chordPose(c);
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
  updateFs();
}
function stopSong(){
  song.running = false; clearInterval(song.timer);
  document.getElementById('btnSong').textContent = '▶ 演奏する';
  highlightSong(-1); showStrip([chordName()]); kick();
  updateFs();
}
document.getElementById('btnSong').onclick = ()=> song.running ? stopSong() : startSong();
renderSong();


/* ---------- タブ譜（メロディ弾き） ----------
   1音ずつ：左手はその音の弦・フレットを決まった指で押さえ、右手はピックでその弦だけを弾く（ダウン・アップを交互に）
   開放弦の音では、左手はその前の位置のまま（指は弦から離す） */
const tabs = {list:[], idx:0, running:false, timer:null, t0:0, bs:0.6, next:0, hl:-1, prep:0, shown:-1};
const TAB = () => tabs.list[tabs.idx];
function loadTabSongs(){
  tabs.list = TAB_SONGS.map(sg=>({...sg, ...parseCompact(sg.tab)}));
  try{ for(const sg of JSON.parse(localStorage.getItem('guitarTabImports') || '[]')) tabs.list.push(sg); }catch(e){}
}
const saveImports = () => { try{ localStorage.setItem('guitarTabImports', JSON.stringify(tabs.list.filter(t=>t.imported), (k,v)=>k === 'plan' ? undefined : v)); }catch(e){} };
loadTabSongs();
const tabList = document.getElementById('tabList'), tabSheet = document.getElementById('tabSheet'), tabBpm = document.getElementById('tabBpm');
function renderTabList(){
  tabList.innerHTML = '';
  tabs.list.forEach((sg,i)=>{
    const b = document.createElement('button'); b.className = 'chip' + (sg.imported ? ' imp' : ''); b.textContent = (sg.imported ? '📥 ' : '') + (sg.short || sg.title);
    b.classList.toggle('on', i === tabs.idx);
    b.onclick = ()=>selectTab(i);
    tabList.appendChild(b);
  });
}
function selectTab(i){
  stopTab(); tabs.idx = i;
  const sg = TAB();
  tabBpm.value = sg.bpm; document.getElementById('tabBpmVal').textContent = sg.bpm;
  renderTabList(); renderTabSheet(); showTabEvent(0, true);
}
// 指の名前（短く）
const FSHORT = ['','人差し','中','薬','小'];
const noteLabel = n => `${STRING_NUM[n.s]}・${n.f ? n.f+'フレット' : '開放'}${n.k ? '（'+FSHORT[n.k]+'指）' : ''}`;
// タブ譜の絵（6本の線に、フレットの数字。数字の丸の色は押さえる指の色）
let BW = 34;   // 1拍の幅（px）：いちばん短い音の間が18px以上になるように広げる
function renderTabSheet(){
  const sg = TAB(), off = sg.pickup ? sg.beats - sg.pickup : 0;
  let gap = 1; sg.events.forEach((e,i)=>{ if(i) gap = Math.min(gap, Math.max(0.2, e.t - sg.events[i-1].t)); });
  BW = Math.min(72, Math.max(34, 18/gap));
  const total = off + sg.length, W = 34 + (Math.ceil((total + 0.01) / sg.beats) * sg.beats) * BW + 10;
  const ly = r => 14 + r*13, H = ly(5) + 16;
  let svg = '';
  for(let r=0;r<6;r++) svg += `<line x1="26" x2="${W-6}" y1="${ly(r)}" y2="${ly(r)}" class="tl"/><text x="12" y="${ly(r)+4}" class="tn">${STRING_NAMES[5-r]}</text>`;
  for(let b = 0; b <= total + 0.01; b += sg.beats){ const x = 34 + (b) * BW - 6; svg += `<line x1="${x}" x2="${x}" y1="${ly(0)}" y2="${ly(5)}" class="tb"/>`; }
  sg.events.forEach((e,i)=>{
    const x = 34 + (e.t + off) * BW;
    svg += `<g class="ev" data-i="${i}"><rect x="${x-9}" y="2" width="18" height="${H-4}" rx="5" class="hl"/>`;
    for(const n of e.notes){
      const y = ly(5 - n.s);
      svg += `<circle cx="${x}" cy="${y}" r="6.6" fill="${n.k ? FINGER_COLORS[n.k] : '#fff'}" stroke="#1d2a30" stroke-width="${n.k ? 0 : 1}"/><text x="${x}" y="${y+3.6}" class="tf">${n.f}</text>`;
    }
    svg += '</g>';
  });
  tabSheet.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${svg}</svg>`;
  tabSheet.querySelectorAll('.ev').forEach(g=>g.onclick = ()=>{ if(!tabs.running){ showTabEvent(+g.dataset.i, true); highlightTab(+g.dataset.i); } });
  document.getElementById('tabInfo').innerHTML = `<b>${sg.title}</b><span>${sg.credit || ''}</span>` +
    `<span>${sg.beats}拍子・${sg.events.length}音${sg.note ? '・' + sg.note : ''}</span>` + (sg.info ? `<span class="muted">${sg.info}</span>` : '');
  document.getElementById('btnTabDel').hidden = !sg.imported;
  tabs.hl = -1;
}
function highlightTab(i){
  if(tabs.hl === i) return; tabs.hl = i;
  tabSheet.querySelectorAll('.ev.now').forEach(g=>g.classList.remove('now'));
  const g = tabSheet.querySelector(`.ev[data-i="${i}"]`);
  if(!g) return;
  g.classList.add('now');
  const x = +g.querySelector('rect').getAttribute('x');
  if(x < tabSheet.scrollLeft + 30 || x > tabSheet.scrollLeft + tabSheet.clientWidth - 80) tabSheet.scrollLeft = Math.max(0, x - 60);
}
// 何番目の音の時の手の形：手はポジション（人差し指のフレット）に置いたまま、指だけで押さえる。開放弦は緑に光らせる
function tabEventPose(sg, i){
  const e = sg.events[i];
  sg.plan ||= fingerPlan(sg.events);
  const pl = sg.plan[i];
  const k = capo(), hover = k ? Object.fromEntries(Object.entries(pl.hover).map(([f,[s,fr,l]])=>[f, [s, fr + k, l]])) : pl.hover;
  const pose = computeTabPose(shiftChord(eventChord(e)), view.rig, (e.P || 1) + k, hover, pl.grip, pl.home);
  const open = e.notes.filter(n=>!n.f).map(n=>n.s);
  return open.length ? {...pose, openStr: open} : pose;
}
// 3D画面の上の表示：いまの音の名前と、弦・フレット・指。左下には「いま → 次」
function showTabEvent(i, still=false){
  const sg = TAB(), e = sg.events[i]; if(!e) return;
  if(tabs.shown === i && !still) return; tabs.shown = i;
  document.getElementById('chordName').textContent = e.notes.map(n=>noteName(n.m + capo())).join('・');
  document.getElementById('chordReading').textContent = e.notes.map(noteLabel).join(' ／ ');
  const nx = sg.events[i+1];
  stripKey = '';
  sg.plan ||= fingerPlan(sg.events);
  const gname = {spread:'指を開く形', diag:'斜めの形'}[sg.plan[i].grip];
  chordCard.innerHTML = `<div class="tabnow"><b>いま・${e.P||1}ポジション・${gname}</b>${e.notes.map(noteLabel).join('<br>')}</div>` +
    (nx ? `<b class="arr">→</b><div class="tabnow next"><b>次</b>${nx.notes.map(noteLabel).join('<br>')}</div>` : '');
  if(still && view){ const now = performance.now(), nx = tabEventPose(sg, i); poseFrom = poseTo ? currentPose(now) : null; tweenStart = now; tweenDur = 160; poseTo = window.__pose = nx; kick(); }
}
// 右手：ピックの先の横の位置（mm）→ 振りの角度
let tabK = 0;
const thetaAt = y => { tabK ||= view.rightHandPose(view.rigR, {theta:0.2, lift:0, wrist:0, roll:0, flick:0}).tip[1] / 0.2; return y / tabK; };
function tabRight(sg, b){
  const ev = sg.events, bs = tabs.bs;
  const strokes = ev.map(e=>{
    const ss = e.notes.map(n=>n.s), lo = Math.min(...ss), hi = Math.max(...ss);
    const down = ss.length > 1 || Math.round(e.t*2) % 2 === 0;           // 表拍はダウン、裏拍はアップ。何本か同時はダウン
    const a = thetaAt(strY(lo, STRUM_X) - 4.5), z = thetaAt(strY(hi, STRUM_X) + 4.5);
    return down ? {from:a, to:z, down} : {from:z, to:a, down};
  });
  const c = 0.045 / bs;                                                    // 弦を通る時間（拍）
  let i = -1; for(let k=0;k<ev.length;k++){ if(ev[k].t - c/2 <= b) i = k; else break; }
  if(i < 0){ const st = strokes[0]; const u = Math.max(0, Math.min(1, (b + 1.5)/1.5)); return {theta: st.from, lift: 6*(1-u) + 1.5, wrist: 0, roll: 0, flick: 0}; }
  const e = ev[i], st = strokes[i];
  if(b <= e.t + c/2){ const u = (b - (e.t - c/2))/c; return {theta: st.from + (st.to - st.from)*u, lift: 0, wrist: 0, roll: 0, flick: st.down ? 6 : -5}; }
  const nx = strokes[i+1];
  if(!nx) return {theta: st.to, lift: Math.min(6, (b - e.t)*6), wrist: 0, roll: 0, flick: 0};
  const t1 = e.t + c/2, t2 = ev[i+1].t - c/2, u = Math.max(0, Math.min(1, (b - t1)/Math.max(1e-3, t2 - t1))), sm = u*u*(3-2*u);
  const far = Math.abs(nx.from - st.to) * tabK;                            // 弦を何mm移動するか
  return {theta: st.to + (nx.from - st.to)*sm, lift: Math.min(5, 0.8 + far*0.12)*Math.sin(Math.PI*u), wrist: 0, roll: 0, flick: 0};
}
// 左手：次に押さえる音の少し前から動き始める
function tabPose(sg, b){
  const ev = sg.events;
  let i = 0; while(i+1 < ev.length && ev[i+1].t <= b) i++;
  if(b < ev[0].t) i = 0;
  showTabEvent(i);
  let pose = tabEventPose(sg, i);
  const j = i + 1;
  if(b >= ev[0].t && j < ev.length){
    // 次の音へ：指だけなら速く、ポジションが変わる（手ごと動く）時は少しゆっくり
    const nx = tabEventPose(sg, j);
    const left = (ev[j].t - b)*tabs.bs, gap = (ev[j].t - ev[i].t)*tabs.bs;
    const shift = (ev[j].P || 1) !== (ev[i].P || 1);
    const dur = Math.min(shift ? 0.28 : 0.17, Math.max(0.06, gap*0.8));
    if(left < dur) pose = (shift ? blendPose : blendTab)(pose, nx, 1 - left/dur);
  }
  return pose;
}
const beatSec = bpm => 60/(bpm*state.speed);
function tickTab(){
  if(!tabs.running || tabs.running === 'ending') return;
  const sg = TAB(), ahead = actx.currentTime + 0.12;
  while(tabs.next < sg.events.length && tabs.t0 + sg.events[tabs.next].t*tabs.bs < ahead){
    const e = sg.events[tabs.next++], when = tabs.t0 + e.t*tabs.bs;
    const ss = e.notes.slice().sort((a,b)=>a.s-b.s);
    ss.forEach((n,k)=>playString(n.s, n.f, when + k*0.012, ss.length > 1 ? 0.34 : 0.46));
  }
  while(tabs.click < 0 && tabs.t0 + tabs.click*tabs.bs < ahead){ click(tabs.t0 + tabs.click*tabs.bs, tabs.click === -sg.beats); tabs.click++; }
  if(tabs.next >= sg.events.length){
    const last = sg.events[sg.events.length-1], endT = tabs.t0 + (last.t + Math.min(2, last.d))*tabs.bs;
    tabs.running = 'ending';
    setTimeout(()=>{ if(tabs.running === 'ending') stopTab(); }, Math.max(0, (endT - actx.currentTime)*1000) + 400);
  }
}
async function startTab(){
  ensureAudio(); if(prog.running) stopProg(); if(song.running) stopSong();
  const sg = TAB(); if(!sg.events.length || !view) return;
  // 曲で使う手の形を先に計算しておく（少しずつ・画面を止めないように）
  const btn = document.getElementById('btnTab');
  sg.plan ||= fingerPlan(sg.events);
  const todo = sg.events.map((e,i)=>[eventChord(e), e.P||1, sg.plan[i]]);   // [コード, ポジション, 指の動き]
  const run = ++tabs.prep;
  for(let k=0;k<todo.length;k++){
    btn.textContent = `準備中 ${k}/${todo.length}`;
    tabEventPose(sg, k);
    await new Promise(r=>setTimeout(r, 0));
    if(run !== tabs.prep) return;                                 // 準備中にストップや曲の変更があった
  }
  tabs.bs = beatSec(+tabBpm.value);
  const cin = sg.beats + (sg.pickup || 0);                          // 1小節カウント（弱起の曲はその分も）
  tabs.t0 = actx.currentTime + 0.3 + cin*tabs.bs; tabs.next = 0; tabs.click = -cin;
  tabs.running = true; tabs.shown = -1;
  btn.textContent = '■ ストップ';
  tabs.timer = setInterval(tickTab, 25);
  tickTab(); kick(); updateFs();
}
function stopTab(){
  tabs.prep++;
  const was = tabs.running;
  tabs.running = false; clearInterval(tabs.timer);
  document.getElementById('btnTab').textContent = '▶ 弾いてみせる';
  if(was && view){ const b = (heardTime() - tabs.t0)/tabs.bs; poseFrom = null; poseTo = tabPose(TAB(), Math.max(0, b)); }
  highlightTab(-1); kick(); updateFs();
}
document.getElementById('btnTab').onclick = ()=> (tabs.running || tabs.prep && document.getElementById('btnTab').textContent.startsWith('準備')) ? stopTab() : startTab();
tabBpm.oninput = ()=>{
  document.getElementById('tabBpmVal').textContent = tabBpm.value;
  retimeTab();
};
function retimeTab(){
  if(!tabs.running || !actx) return;
  const ct = actx.currentTime, b = (ct - tabs.t0)/tabs.bs, bs = beatSec(+tabBpm.value);
  tabs.t0 = ct - b*bs; tabs.bs = bs;
}
/* 取り込み：ファイル（MIDI・MusicXML・文字のタブ譜）か、貼り付けた文字のタブ譜 */
const tabMsg = document.getElementById('tabMsg');
function addImported(res, title){
  const sg = {title, short: title.length > 14 ? title.slice(0,13) + '…' : title, credit:'取り込んだ曲', bpm: Math.min(160, Math.max(40, res.bpm || 90)), beats:4, pickup:0,
              events: res.events, length: res.length, info: res.info || '', imported: true};
  if(!sg.events.length) throw new Error('弾ける音が見つかりませんでした');
  tabs.list.push(sg); saveImports();
  selectTab(tabs.list.length - 1);
  tabMsg.className = 'msg ok';
  tabMsg.textContent = `「${title}」を取り込みました（${sg.events.length}音）。押さえる指は自動で決めています`;
}
const fail = e => { tabMsg.className = 'msg bad'; tabMsg.textContent = '取り込めませんでした：' + (e.message || e); };
document.getElementById('tabFile').onchange = async ev=>{
  const f = ev.target.files[0]; ev.target.value = '';
  if(!f) return;
  const name = f.name.replace(/\.[^.]+$/, ''), ext = (f.name.match(/\.([^.]+)$/)?.[1] || '').toLowerCase();
  try{
    let res;
    if(ext === 'mid' || ext === 'midi') res = parseMidi(await f.arrayBuffer());
    else if(ext === 'mxl') res = parseMusicXML(await readMxl(await f.arrayBuffer()));
    else { const text = await f.text(); res = /<score-(partwise|timewise)/.test(text) ? parseMusicXML(text) : parseTabText(text); }
    addImported(res, name);
  }catch(e){ console.error(e); fail(e); }
};
document.getElementById('tabPasteGo').onclick = ()=>{
  const text = document.getElementById('tabPaste').value;
  try{ addImported(parseTabText(text), document.getElementById('tabPasteName').value.trim() || '貼り付けたタブ譜'); }catch(e){ fail(e); }
};
document.getElementById('btnTabDel').onclick = ()=>{
  const sg = TAB(); if(!sg.imported) return;
  tabs.list.splice(tabs.idx, 1); saveImports(); selectTab(0);
};
renderTabList(); renderTabSheet();

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
  let pose = chordPose(cur);
  for(let j = k+1; j <= k+pl.spb && j < pl.end; j++){
    const nx = pl.chordAt(j);
    if(nx === cur) continue;
    const left = (warp(j) - warp(ph))*pl.o.e8;              // 次のコードまでの秒数
    const dur = Math.min(0.32, pl.o.e8*2*0.9);              // 動かす時間（最大でも1拍弱）
    if(left < dur){
      const t = 1 - left/dur;
      pose = blendPose(pose, chordPose(nx), t);
    }
    break;
  }
  return pose;
}

// 次と、その次に弾くコード（コードが変わる所を先までさがす）。次まで1拍を切ったら光らせる
function upcoming(pl, ph){
  const k = Math.max(0, Math.floor(ph)), names = [pl.chordAt(k)];
  let j = k, soon = false;
  while(names.length < 3){
    const last = names[names.length-1];
    let n = j + 1;
    while(n < pl.end && n < j + 8*pl.spb && pl.chordAt(n) === last) n++;
    if(n >= pl.end || pl.chordAt(n) === last) break;
    if(names.length === 1) soon = n - ph <= 2;
    names.push(pl.chordAt(n)); j = n;
  }
  showStrip(names, soon);
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
//  ・重い端末では、動いている間だけ自動で解像度を下げる
let rSmooth = null, lastFrame = 0, frameAvg = 16, quality = 1, wasMoving = false, slowCount = 0, lowPower = false;
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
  const tabOn = tabs.running && tabs.running !== false;
  const pl = tabOn ? null : playing();
  // 手の動きは音より少しだけ先に（目で見て準備できるように）：左手0.12秒・右手0.04秒
  const tNow = pl ? heardTime() - pl.o.t0 : 0;
  const ph  = pl ? unwarp(tNow/pl.o.e8) : 0;                       // 今どの8分音符か（スイングを戻して数える）
  const phL = pl ? unwarp((tNow + HAND_LEAD_L)/pl.o.e8) : 0;
  const phR = pl ? unwarp((tNow + HAND_LEAD_R)/pl.o.e8) : 0;
  const handMoving = !!poseFrom;
  const active = !!pl || !!oneShot || tabOn;
  const showRight = state.rightMode === 'always' || (state.rightMode === 'playing' && active);
  const camMoving = view.tick();                                   // カメラを回している・慣性で動いている間も「動いている」扱い（解像度を自動で下げる）
  const moving = handMoving || active || camMoving;
  if(moving && wasMoving){
    frameAvg = frameAvg*0.9 + Math.min(100, now - lastFrame)*0.1;
    if(frameAvg > 24 && quality > 0.5) { quality = Math.max(0.5, quality - 0.1); frameAvg = 16; }
    else if(frameAvg > 24 && quality <= 0.5 && ++slowCount > 40 && !lowPower){ lowPower = true; view.setShadows(false); }   // それでも重ければ影を切る
    else if(frameAvg < 17.5 && quality < 1) quality = Math.min(1, quality + 0.02);
  }
  lastFrame = now;
  if(!moving && wasMoving){ quality = 1; dirty = true; }   // 止まったらきれいに描き直す
  if(dirty || moving){
    let pose, right = null;
    if(tabOn){
      const sg = TAB(), tb = heardTime() - tabs.t0;
      const bL = (tb + HAND_LEAD_L)/tabs.bs, bR = (tb + HAND_LEAD_R)/tabs.bs;
      pose = tabPose(sg, Math.max(-1, bL));
      if(showRight) right = tabRight(sg, bR);
      highlightTab(bL < 0 ? -1 : tabs.shown);
    } else if(pl){
      pose = musicPose(pl, phL);
      upcoming(pl, phL);
      if(pl.o === prog) highlightProg(ph < 0 ? -1 : (prog.pos + Math.floor(ph/8)) % prog.list.length, ph < 0 ? -1 : Math.floor(ph) % 8);
      else highlightSong(ph < 0 || ph >= pl.end ? -1 : Math.floor(ph/pl.spb));
    } else pose = currentPose(now);
    if(!tabOn) right = showRight ? rightState(now, pl, phR) : null;
    right = window.__forceRight || smoothRight(right, now);
    view.render(pose, {...state, right, quality: moving ? quality : 1, animating: handMoving || active});
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
  mainOverlay: document.getElementById('mainOverlay'),
  onTap: ()=>strum(getChord(chordName()))
}).then(v=>{
  view = v; window.__view = v;
  view.onChange(kick);
  document.getElementById('loading')?.remove();
  view.setBackdrop(state.bg); view.setGuitar(state.guitar, state.finish); applyToggles();
  view.setCapo(state.capo || 0);
  setChord(state.root+state.type, false);
  window.__ready = true;
  // 残りのコードの手の形も、ひまな時間に先に計算しておく（切り替えが引っかからないように）
  // 練習・演奏デモで使うコードを先に
  const first = new Set([...SONGS.flatMap(sg=>sg.bars.flat().map(c=>c[0])), ...PROGRESSIONS.flatMap(p=>p.chords)]);
  const rest = [...first, ...Object.keys(CHORDS).filter(c=>!first.has(c))];
  const idle = window.requestIdleCallback || (fn=>setTimeout(()=>fn({timeRemaining:()=>8}), 30));
  const work = dl => { while(rest.length && dl.timeRemaining() > 4) chordPose(rest.shift()); if(rest.length) idle(work); };
  idle(work);
}).catch(err=>{
  console.error(err);
  document.getElementById('mainWrap').innerHTML = '<p style="padding:30px;color:#c9b6a3">この端末では3D表示が使えません（WebGLが無効です）。</p>';
});

/* ---------- カポの切り替え ---------- */
const capoVal = document.getElementById('capoVal');
function applyCapo(){
  state.capo = Math.max(0, Math.min(9, state.capo || 0));
  capoVal.textContent = state.capo ? state.capo + 'フレット' : 'なし';
  document.getElementById('capoDown').disabled = !state.capo;
  document.getElementById('capoUp').disabled = state.capo >= 9;
  saveSettings();
  if(view) view.setCapo(state.capo);
  stripKey = '';
  if(tabs.running || prog.running || song.running) return;
  if(activeTab() === 'tabs' && tabs.shown >= 0) showTabEvent(tabs.shown, true);
  else setChord(chordName(), true);
}
document.getElementById('capoDown').onclick = ()=>{ if(prog.running) stopProg(); if(song.running) stopSong(); stopTab(); state.capo--; applyCapo(); };
document.getElementById('capoUp').onclick = ()=>{ if(prog.running) stopProg(); if(song.running) stopSong(); stopTab(); state.capo++; applyCapo(); };
applyCapo();
importFromHash();   // 取り込みボタンから開いた時（画面の準備がすべて終わってから）
window.addEventListener('hashchange', importFromHash);   // すでに開いている画面に、取り込みボタンから送られて来た時

/* ---------- 内カメラの小窓：自分の手を映して、3Dの手と見比べながら練習する ----------
   ・カメラの映像はこの端末の中だけで表示する（どこにも送らない・保存しない）
   ・ふつうは3Dの横（スマホの縦向きでは下）に並べて、3Dの手と重ならないようにする
   ・「小窓にする」で3Dの上に重ねる小窓にもできる。小窓はドラッグで好きな場所へ、大きさは 小・中・大
   ・左右反転（鏡のように見える）も切り替えられる
   ・「3Dを合わせる」：3Dを正面（向かい合った向き）＋左右反転にして、鏡に映った自分と同じ向きにする */
const camBtn = document.getElementById('camBtn'), camWin = document.getElementById('camWin');
const camVideo = document.getElementById('camVideo'), camMsg = document.getElementById('camMsg');
state.cam = {size:'m', flip:true, x:null, y:null, layout:'side', ...(state.cam || {})};
let camStream = null;
function camLayout(){
  const side = state.cam.layout === 'side' && !camWin.hidden;
  document.getElementById('mainWrap').classList.toggle('camside', side);
  camWin.classList.remove('s','m','l'); if(!side) camWin.classList.add(state.cam.size);
  camVideo.classList.toggle('flip', state.cam.flip);
  document.getElementById('camSize').hidden = side;
  document.getElementById('camLayoutBtn').textContent = side ? '小窓にする' : '並べる';
  if(!side && state.cam.x != null){ camWin.style.left = state.cam.x*100 + '%'; camWin.style.top = state.cam.y*100 + '%'; camWin.style.right = camWin.style.bottom = 'auto'; }
  else camWin.style.left = camWin.style.top = camWin.style.right = camWin.style.bottom = '';
  kick();
}
async function camStart(){
  camWin.hidden = false; camBtn.classList.add('on'); camLayout();
  camMsg.className = 'cammsg on'; camMsg.textContent = 'カメラを準備中…';
  try{
    if(!navigator.mediaDevices?.getUserMedia) throw new Error('nosupport');
    camStream = await navigator.mediaDevices.getUserMedia({video:{facingMode:'user', width:{ideal:1280}, height:{ideal:720}}, audio:false});
    camVideo.srcObject = camStream; await camVideo.play().catch(()=>{});
    camMsg.className = 'cammsg';
  }catch(e){
    camMsg.textContent = e.message === 'nosupport' ? 'この画面ではカメラが使えません（https のページで開いてください）'
      : e.name === 'NotAllowedError' ? 'カメラの使用が許可されませんでした。ブラウザの設定でカメラを許可してください'
      : e.name === 'NotFoundError' ? 'カメラが見つかりませんでした' : 'カメラを開けませんでした';
  }
}
function camStop(){
  camStream && camStream.getTracks().forEach(t=>t.stop()); camStream = null;
  camVideo.srcObject = null; camWin.hidden = true; camBtn.classList.remove('on'); camLayout();
}
camBtn.onclick = ()=> camStream || !camWin.hidden ? camStop() : camStart();
document.getElementById('camClose').onclick = camStop;
document.getElementById('camLayoutBtn').onclick = ()=>{ state.cam.layout = state.cam.layout === 'side' ? 'pip' : 'side'; camLayout(); saveSettings(); };
document.getElementById('camFlip').onclick = ()=>{ state.cam.flip = !state.cam.flip; camLayout(); saveSettings(); };
document.getElementById('camSize').onclick = ()=>{ state.cam.size = {s:'m', m:'l', l:'s'}[state.cam.size]; camLayout(); saveSettings(); };
document.getElementById('camMatch').onclick = ()=>{
  angle1 = 'front'; document.getElementById('angleBtn').textContent = '🎥 ' + VIEWS.front.label;
  if(view) view.setView('front');
  state.mirror = true; applyToggles(); saveSettings(); kick();
};
// ドラッグで動かす（ボタンの上ではドラッグしない）
{
  let drag = null;
  camWin.addEventListener('pointerdown', e=>{
    if(e.target.closest('button') || state.cam.layout === 'side') return;
    e.stopPropagation(); e.preventDefault();
    const r = camWin.getBoundingClientRect(), pr = camWin.parentElement.getBoundingClientRect();
    drag = {dx: e.clientX - r.left, dy: e.clientY - r.top, pr, w: r.width, h: r.height};
    camWin.setPointerCapture(e.pointerId);
  });
  camWin.addEventListener('pointermove', e=>{
    if(!drag) return;
    const {pr, w, h} = drag;
    const x = Math.min(pr.width - w, Math.max(0, e.clientX - pr.left - drag.dx)), y = Math.min(pr.height - h, Math.max(0, e.clientY - pr.top - drag.dy));
    state.cam.x = x / pr.width; state.cam.y = y / pr.height; camLayout();
  });
  const end = ()=>{ if(drag){ drag = null; saveSettings(); } };
  camWin.addEventListener('pointerup', end); camWin.addEventListener('pointercancel', end);
}
