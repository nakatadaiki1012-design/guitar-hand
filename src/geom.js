/* =========================================================
   ギターの寸法（単位 mm）
   アコースティック：ドレッドノート（Martin D-28 を参考）… 弦長645 / ナット幅44.5 / ボディ長508
                     アッパー292 / ウエスト273 / ロワー397 / 厚み約115 / サウンドホール直径100 / 20フレット（14フレットでボディにつながる）
   エレキ　　　　　：ストラトタイプ（Fender Stratocaster を参考）… 弦長648 / ナット幅42 / 22フレット
                     ボディ長400・幅325・厚み45 / 3つのシングルコイル・トレモロブリッジ・6連ペグ
   座標：x = ナット→ボディ方向 / y = 6弦(低いE・天井側)→1弦(高いE・床側) / z = 指板の表（客席側）
   指板の表面が z=0、指板の厚みは FB_T（その下がネック）
   ギターの種類を切り替えると、下の値（let）がまるごと入れ替わる（setGuitarType）
   ========================================================= */
export const NSTR = 6;                                          // 弦の本数
export const GUITARS = {
  acoustic: {
    label:'アコースティック',
    scale:645, nutHalf:22.25, halfSlope:0.0147,                // 指板の半幅（ナット44.5mm → 12F付近54mm）
    sp0:7.2, spSlope:0.00558,                                   // 弦の間隔（ナット36mm → サドル54mm：両端の弦の間）
    act0:1.7, actSlope:0.0057,                                  // 弦の高さ（指板の表から）
    strR:[0.67,0.53,0.41,0.30,0.20,0.15],                       // 弦の太さ（半径・.012〜.053のライトゲージ）
    wound:4,                                                    // 巻き弦の本数（6〜3弦）
    fbT:6, neck0:15.5, neckSlope:0.0085, neckMaxX:360,          // 指板の厚み・ネックの厚み（指板の下）
    bodyFret:14, frets:20, fbEndFret:20.6,
    bodyLen:508, bodyDepth:115, topZ:-6,                        // ボディの表板の高さ（指板の下面と同じ）
    headLen:190,
  },
  electric: {
    label:'エレキ',
    scale:648, nutHalf:21, halfSlope:0.0154,                    // ナット42mm → 12F付近52mm
    sp0:7.0, spSlope:0.0054,                                    // ナット35mm → ブリッジ52.5mm
    act0:1.6, actSlope:0.0045,                                  // エレキは弦が低い
    strR:[0.58,0.45,0.33,0.215,0.165,0.127],                    // .010〜.046
    wound:3,
    fbT:6, neck0:15, neckSlope:0.005, neckMaxX:400,
    bodyFret:16.9, frets:22, fbEndFret:22.6,
    bodyLen:343, bodyDepth:45, topZ:-10,                        // ボディの表はネックの指板より10mm下（ネックをはめこむ）
    headLen:195,
  },
};
export let GTYPE = 'acoustic', G = GUITARS.acoustic;
export let SCALE_LEN, FRET_TOP = 1.2, FB_T, NECK_BACK_Z, BODY_X0, BODY_LEN, BODY_DEPTH, BODY_TOP, FB_END, HEAD_LEN, NUM_FRETS, STRING_R, STRUM_X;
export const fretX = n => G.scale*(1-Math.pow(2,-n/12));        // 実物と同じフレット間隔
export const slotCenter = f => (fretX(f-1)+fretX(f))/2;
export const halfW = x => G.nutHalf + Math.max(0,x)*G.halfSlope;   // 指板の半幅
export const strY = (i,x) => (i-(NSTR-1)/2)*(G.sp0 + Math.max(0,x)*G.spSlope);
export const stringZ = x => G.act0 + x*G.actSlope;               // 開放弦の高さ
export const NECK_DEPTH = x => G.neck0 + Math.min(Math.max(0,x),G.neckMaxX)*G.neckSlope;   // ネックの厚み（指板の下）

export function setGuitarType(t){
  GTYPE = GUITARS[t] ? t : 'acoustic'; G = GUITARS[GTYPE];
  SCALE_LEN = G.scale; FB_T = G.fbT; STRING_R = G.strR;
  NECK_BACK_Z = -FB_T - NECK_DEPTH(40);                          // 1〜3フレットあたりのネック裏
  BODY_X0 = fretX(G.bodyFret); BODY_LEN = G.bodyLen; BODY_DEPTH = G.bodyDepth; BODY_TOP = G.topZ;
  FB_END = fretX(G.fbEndFret); HEAD_LEN = G.headLen; NUM_FRETS = G.frets;
  // 右手で弾く場所：アコギはサウンドホールの上（指板の終わりのすぐ先）、エレキはフロントとセンターのピックアップの間
  STRUM_X = GTYPE === 'electric' ? 520 : FB_END + 38;
}
setGuitarType('acoustic');

/* ---------- ベクトル計算 ---------- */
export const add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
export const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
export const mul=(a,s)=>[a[0]*s,a[1]*s,a[2]*s];
export const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
export const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export const vlen=a=>Math.hypot(a[0],a[1],a[2]);
export const norm=a=>{const l=vlen(a)||1; return [a[0]/l,a[1]/l,a[2]/l];};
export const lerp=(a,b,t)=>a+(b-a)*t;
export const lerp3=(a,b,t)=>[lerp(a[0],b[0],t),lerp(a[1],b[1],t),lerp(a[2],b[2],t)];
export const DEG = Math.PI/180;
