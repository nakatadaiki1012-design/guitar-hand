// src/ のコードを1つにまとめて、ダブルクリックで開ける index.html を作る
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';

const result = await build({
  entryPoints: ['src/app.js'],
  bundle: true, minify: true, format: 'iife', write: false,
  loader: { '.glb': 'binary' },
  legalComments: 'inline',
  target: ['es2020'],
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const html = readFileSync('src/template.html', 'utf8').replace('<!--APP-->', () => `<script>${js}</script>`);
writeFileSync('index.html', html);
// 公開用（Cloudflare など）：dist/ には完成したページだけを置く（node_modules などを一緒に上げないように）
mkdirSync('dist', {recursive: true});
writeFileSync('dist/index.html', html);
console.log(`index.html: ${(html.length/1024).toFixed(0)} KB`);
