/* =========================================================
   ウクレレの寸法（単位 mm）
   参考：Kala KA-C（コンサート）… 弦長381 / ボディ長281 / アッパー152 / ウエスト125 / ロワー210 / 厚み70 / 全長608
   座標：x = ナット→ボディ方向 / y = 4弦(G・天井側)→1弦(A・床側) / z = 指板の表（客席側）
   指板の表面が z=0、ボディの表板の表面が z=-5（指板の厚み5mm）
   ========================================================= */
export const SCALE_LEN = 381;
export const fretX = n => SCALE_LEN*(1-Math.pow(2,-n/12));     // 実物と同じフレット間隔
export const slotCenter = f => (fretX(f-1)+fretX(f))/2;
export const halfW = x => 17.6 + Math.max(0,x)*0.0165;          // 指板の半幅（ナット35mm → 14F付近42mm）
export const strY = (i,x) => (i-1.5)*(9.3 + Math.max(0,x)*0.0135);
export const STRING_R = [0.35,0.45,0.4,0.33];                   // 弦の太さ（半径）
export const stringZ = x => 2.0 + x*0.0063;                     // 開放弦の高さ（ナット2.0 → サドル4.4）
export const FRET_TOP = 1.2;                                    // フレットの高さ
export const NECK_DEPTH = x => 15.5 + Math.min(x,210)*0.017;    // ネックの厚み（指板の下）
export const NECK_BACK_Z = -5 - NECK_DEPTH(40);                 // 1〜3フレットあたりのネック裏
export const BODY_X0 = fretX(14);                               // ボディの始まり（14フレット）
export const BODY_LEN = 281, BODY_DEPTH = 70;
export const FB_END = fretX(18.6);                              // 指板の終わり
export const HEAD_LEN = 117;
export const NUM_FRETS = 18;

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
