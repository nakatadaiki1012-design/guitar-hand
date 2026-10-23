/* =========================================================
   コード譜からコード進行を取り出す
   ・U-FRET などのコード譜サイトの文章（コピーしたもの）、ChordPro（[C]歌詞[G]歌詞）、コード名だけの行、どれでも読める
   ・歌詞は読み飛ばして、コード名だけを順番に取り出す（歌詞は保存しない）
   ・「Capo 2」「カポ2」のような書き込みがあればカポも読み取る
   ・取り込みボタン（ブックマークレット）：コード譜のページで押すと、同じ読み取りをそのページの中で行い、
     結果（曲名・コード・カポ）だけをこのアプリのURLの後ろ（#import=…）に付けて開く
   ========================================================= */

// 「コードらしい文字」の形：根音 A〜G ＋ #/b ＋ 種類（m, 7, maj7, sus4, add9, dim, aug, (9) など）＋ 分数コード
const CHORD_RE = /^[A-G][#b♯♭]?(?:m|M|maj|min|dim|aug|sus|add|△|°|ø|\+|-)?[0-9]{0,2}(?:[#b♯♭-]?[0-9]{1,2})?(?:\([^)]{1,6}\))?(?:\/[A-G][#b♯♭]?)?$/;
const CHORD_WORD_RE = /^(?:[A-G][#b♯♭]?(?:m|M|maj|min|dim|aug|sus|add|△|°|ø|\+|-)?[0-9]{0,2}(?:[#b♯♭-]?[0-9]{1,2})?(?:\([^)]{1,6}\))?(?:\/[A-G][#b♯♭]?)?|N\.?C\.?)$/i;
const SKIP_RE = /^(?:x\d|×\d|\d+x|\(\d+x\)|\||\/|-|–|—|→|・|,|、|:|：|\.|…|rit\.?|intro|outro|verse|chorus|bridge|solo|ending|イントロ|アウトロ|間奏|サビ|Aメロ|Bメロ|Cメロ|\d+)$/i;

/* 1つの文字列（1行）をコード名の並びにする。コードの行でなければ null */
export function chordsInLine(line){
  const t = line.normalize('NFKC').replace(/[|｜／→・,、]/g, ' ').replace(/\[([^\]]{1,10})\]/g, ' $1 ').trim();
  if(!t) return null;
  const toks = t.split(/\s+/).filter(x => x && !SKIP_RE.test(x));
  if(!toks.length) return null;
  const chords = toks.filter(x => CHORD_WORD_RE.test(x));
  // 「Am」だけの行のようにコードばかりなら、コードの行。歌詞の行（英語の歌詞など）は、コードらしい語がほとんどないので外れる
  if(chords.length < 1 || chords.length / toks.length < 0.6) return null;
  return chords.filter(x => !/^N\.?C\.?$/i.test(x));
}

/* コード譜の文章 → {title, chords, capo} */
export function parseChordSheet(text){
  const src = String(text || '').normalize('NFKC');
  const lines = src.split(/\r?\n/);
  let chords = [], title = '', capo = 0;
  const m = src.match(/(?:capo|カポ(?:タスト)?)\s*[:：=]?\s*(\d)\s*(?:fret|f|フレット)?/i);
  if(m) capo = +m[1];
  if(/\[[A-G][#b♯♭]?[^\]]{0,8}\]/.test(src)){                       // ChordPro（歌詞の中にコードがはさまっている）
    const re = /\[([A-G][#b♯♭]?[^\]]{0,8})\]/g; let x;
    while((x = re.exec(src))) chords.push(x[1]);
    const tl = src.match(/\{(?:title|t):\s*([^}]+)\}/i); if(tl) title = tl[1].trim();
  } else {
    for(const line of lines){
      const c = chordsInLine(line);
      if(c) chords.push(...c);
      else if(!title && line.trim() && line.trim().length <= 40 && !/capo|カポ/i.test(line) && !SKIP_RE.test(line.trim())) title = line.trim();
    }
  }
  if(chords.length > 400) chords = chords.slice(0, 400);
  return {title, chords, capo};
}

/* ページの題名から曲名だけ取り出す（「曲名 / 歌手 ギターコード譜 - サイト名」のような形） */
export function cleanTitle(t){
  return String(t || '').replace(/\s*[-|｜–].*$/, '').replace(/\s*(ギター)?コード(譜)?.*$/, '').replace(/\s*\/.*$/, '').trim().slice(0, 40);
}

/* 取り込みボタン（ブックマークレット）のコード。appUrl：このアプリのURL（# より前） */
export function bookmarkletCode(appUrl){
  // ページの文字を読み取って、曲名・コード・カポだけをアプリのURLに付けて開く。
  // ページの外には何も送らない（アプリのURLに付くのは、読み取ったコード名だけ）
  const fn = function(APP){
    var RE = /^(?:[A-G][#b♯♭]?(?:m|M|maj|min|dim|aug|sus|add|△|°|ø|\+|-)?[0-9]{0,2}(?:[#b♯♭-]?[0-9]{1,2})?(?:\([^)]{1,6}\))?(?:\/[A-G][#b♯♭]?)?|N\.?C\.?)$/i;
    var SK = /^(?:x\d|×\d|\d+x|\(\d+x\)|\||\/|-|–|—|→|・|,|、|:|：|\.|…|intro|outro|イントロ|アウトロ|間奏|サビ|Aメロ|Bメロ|\d+)$/i;
    var txt = (document.body.innerText || '').normalize('NFKC'), out = [];
    txt.split(/\r?\n/).forEach(function(line){
      var t = line.replace(/[|｜／→・,、]/g, ' ').replace(/\[([^\]]{1,10})\]/g, ' $1 ').trim(); if(!t) return;
      var toks = t.split(/\s+/).filter(function(x){ return x && !SK.test(x); }); if(!toks.length) return;
      var c = toks.filter(function(x){ return RE.test(x); });
      if(c.length && c.length / toks.length >= 0.6) c.forEach(function(x){ if(!/^N\.?C\.?$/i.test(x)) out.push(x); });
    });
    if(!out.length){ alert('このページからコードが見つかりませんでした'); return; }
    var cm = txt.match(/(?:capo|カポ(?:タスト)?)\s*[:：=]?\s*(\d)/i);
    var title = document.title.replace(/\s*[-|｜–].*$/, '').replace(/\s*(ギター)?コード(譜)?.*$/, '').replace(/\s*\/.*$/, '').trim().slice(0, 40);
    var data = encodeURIComponent(JSON.stringify({t: title, c: out.slice(0, 400), k: cm ? +cm[1] : 0}));
    var url = APP + '#import=' + data;
    var w = window.open(url, 'guitarhand'); if(!w) location.href = url;
  };
  return 'javascript:(' + fn.toString() + ')(' + JSON.stringify(appUrl) + ')';
}
