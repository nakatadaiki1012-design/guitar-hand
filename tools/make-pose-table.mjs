/* 計算ずみの手の形の表（src/pose-table.js）を作る
   使い方：npm run build のあと  node tools/make-pose-table.mjs  → もう一度 npm run build
   ブラウザ（Playwright）でアプリを開き、ギター3種類それぞれで、全コードとサンプル曲のソロの構えの手の形を計算して書き出す。
   pose.js の手の形の決め方を変えた時は、作り直す（表が古いと、計算し直した形とずれる） */
import { createRequire } from 'module';
import { writeFileSync } from 'fs';
import { execSync } from 'child_process';
const require = createRequire(import.meta.url);
let pw; try{ pw = require('playwright'); }catch(e){ pw = require(execSync('npm root -g').toString().trim() + '/playwright'); }
const url = 'file://' + new URL('../index.html', import.meta.url).pathname;
const b = await pw.chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const table = {};
for(const guitar of ['acoustic','electric','lespaul']){
  const p = await b.newPage({viewport:{width:600, height:500}});
  await p.addInitScript(g=>{ localStorage.setItem('guitarQuality','low'); localStorage.setItem('guitarSettings', JSON.stringify({guitar:g, capo:0})); }, guitar);
  await p.goto(url);
  await p.waitForFunction(()=>window.__ready, null, {timeout:120000});
  const t = await p.evaluate(async ()=>{
    const D = window.__dbg;
    D.setPoseTable && D.setPoseTable(null);
    for(const name of D.chordNames()){ D.chordPose(name); await new Promise(r=>setTimeout(r,0)); }
    for(const sg of D.tabSongs()){ if(sg.imported) continue; for(let i=0;i<sg.events.length;i++) D.prep(sg, i); await new Promise(r=>setTimeout(r,0)); }
    return D.dumpPoseTable();
  });
  Object.assign(table, t);
  console.log(guitar, Object.keys(Object.values(t)[0]).length, '形');
  await p.close();
}
await b.close();
writeFileSync(new URL('../src/pose-table.js', import.meta.url),
  '// 計算ずみの手の形（tools/make-pose-table.mjs で作る）。{ギター: {コード名または構えの名前: [pitch, yaw, roll, yK, zK, dx1, dx2, dx3, dx4]}}\n' +
  'export const POSE_TABLE = ' + JSON.stringify(table) + ';\n');
console.log('src/pose-table.js を書き出しました');
