/* からだログ — お手本アニメ
 * 棒人間を関節の角度で動かす。絵は描かず、姿勢を数で決めて線を引く。
 * 座標は x 右・y 上(床が 0)、角度は度。人は右を向いている。
 * 種目ごとに「始まりの姿勢 A」「終わりの姿勢 B」と、動きの流れ(phases)を持つ。
 * phases は [名前, 秒, Aからの割合(始), (終), 吹き出しの札] の並び。 */
(function () {
  'use strict';

  const W = 320, H = 232, GROUND = 214;   // 論理サイズと床の高さ(画面座標)
  const L = { shin: 46, thigh: 48, torso: 58, neck: 9, head: 11, upper: 31, fore: 29, foot: 15 };
  const ARM = L.upper + L.fore;
  const PAUSE = 0.5;                      // 動きの始まりと終わりで止める秒数

  const rad = d => d * Math.PI / 180;
  const deg = r => r * 180 / Math.PI;
  const pt = (x, y) => ({ x: x, y: y });
  const step = (p, len, d) => pt(p.x + len * Math.cos(rad(d)), p.y + len * Math.sin(rad(d)));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = t => t * t * (3 - 2 * t);
  const mid = (a, b) => pt((a.x + b.x) / 2, (a.y + b.y) / 2);
  const angle = (a, b) => deg(Math.atan2(b.y - a.y, b.x - a.x));
  const lerpPose = (A, B, t) => { const o = {}; for (const k in A) o[k] = lerp(A[k], B[k], t); return o; };

  /* a から b へ、長さ l1・l2 の2本でつなぐときの関節。side が 1 なら a→b の左回り側へ折れる */
  function ik(a, b, l1, l2, side) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const d = Math.max(Math.abs(l1 - l2) + 0.01, Math.min(Math.hypot(dx, dy), l1 + l2 - 0.01));
    const c = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d);
    const t = Math.acos(Math.max(-1, Math.min(1, c)));
    const ang = Math.atan2(dy, dx) + (side >= 0 ? t : -t);
    return pt(a.x + l1 * Math.cos(ang), a.y + l1 * Math.sin(ang));
  }

  /* ---------- 描く道具 ---------- */

  const P = p => [p.x, GROUND - p.y];

  function line(g, pts, color, w) {
    g.strokeStyle = color; g.lineWidth = w; g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath();
    pts.forEach((p, i) => { const [x, y] = P(p); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
    g.stroke();
  }

  function headAt(g, c, color) {
    const [x, y] = P(c);
    g.fillStyle = color; g.beginPath(); g.arc(x, y, L.head, 0, Math.PI * 2); g.fill();
  }

  /* 床からの四角(椅子・段差など)。x, y は左下 */
  function box(g, x, y, w, h, color) {
    g.fillStyle = color;
    g.fillRect(x, GROUND - y - h, w, h);
  }

  function chair(g, x, seat, col) {
    box(g, x, seat - 6, 46, 6, col.floor);
    box(g, x + 3, 0, 5, seat - 6, col.floor);
    box(g, x + 38, 0, 5, seat - 6, col.floor);
    box(g, x, seat, 5, 46, col.floor);
  }

  /* チューブ。端は手(または足・アンカー) */
  function band(g, a, b, col) {
    g.save(); g.globalAlpha = 0.75;
    line(g, [a, b], col.accent, 3);
    g.restore();
  }

  function anchor(g, a, col) {
    line(g, [pt(a.x + 4, 0), pt(a.x + 4, GROUND - 4)], col.floor, 4);   // ドア
    const [x, y] = P(a);
    g.fillStyle = col.accent; g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.fill();
  }

  function floor(g, col) {
    g.clearRect(0, 0, W, H);
    g.strokeStyle = col.floor; g.lineWidth = 3;
    g.beginPath(); g.moveTo(10, GROUND + 2); g.lineTo(W - 10, GROUND + 2); g.stroke();
  }

  const leg = (g, pts, col, far) => line(g, pts, far ? col.far : col.ink, 9);
  const arm = (g, pts, col, far) => line(g, pts, far ? col.far : col.ink, 7);
  const trunk = (g, a, b, col) => line(g, [a, b], col.ink, 11);

  /* 横向きの立ち姿。足首から上へ角度でつなぐ */
  function stand(ankle, s) {
    const toe = pt(ankle.x + L.foot, 0);
    const knee = step(ankle, L.shin, s.shin);
    const hip = step(knee, L.thigh, s.thigh);
    const sh = step(hip, L.torso, s.torso);
    const hd = step(sh, L.neck + L.head, s.torso);
    return { ankle: ankle, toe: toe, knee: knee, hip: hip, sh: sh, hd: hd, mid: mid(hip, sh) };
  }

  /* 立ち姿をまとめて描く。奥の脚は少しずらして薄く */
  function drawStand(g, f, col, o) {
    o = o || {};
    if (o.farArm) arm(g, [f.sh, o.farArm.el, o.farArm.wr], col, true);
    if (!o.noFarLeg) {
      const d = -5;
      leg(g, [pt(f.toe.x + d, f.toe.y), pt(f.ankle.x + d, f.ankle.y), pt(f.knee.x + d, f.knee.y), f.hip], col, true);
    }
    leg(g, [f.toe, f.ankle, f.knee, f.hip], col);
    trunk(g, f.hip, f.sh, col);
    headAt(g, f.hd, col.ink);
  }

  function limbs(sh, up, fo) {
    const el = step(sh, L.upper, up);
    return { el: el, wr: step(el, L.fore, fo) };
  }

  /* 正面向きの体。lean で上体を左右へ寄せる */
  function front(o) {
    const sx = 160 + (o.lean || 0), hx = 160 + (o.lean || 0) * 0.35;
    const f = {
      hipC: pt(hx, 98), shC: pt(sx, 152),
      hipL: pt(hx - 12, 98), hipR: pt(hx + 12, 98),
      shL: pt(sx - 20, 152), shR: pt(sx + 20, 152),
      footL: pt(160 - o.feet, 2), footR: pt(160 + o.feet, 2),
    };
    f.kneeL = ik(f.hipL, f.footL, L.thigh, L.shin, 1);
    f.kneeR = ik(f.hipR, f.footR, L.thigh, L.shin, -1);
    f.hd = pt(sx, 152 + L.neck + L.head);
    f.mid = mid(f.hipC, f.shC);
    return f;
  }

  /* 正面向きの両腕。手の位置を決めると肘が決まる(肘は体の外側へ張る) */
  function frontArms(g, f, hL, hR, col) {
    const elL = ik(f.shL, hL, L.upper, L.fore, 1);
    const elR = ik(f.shR, hR, L.upper, L.fore, -1);
    arm(g, [f.shL, elL, hL], col);
    arm(g, [f.shR, elR, hR], col);
    return { elL: elL, elR: elR, wrL: hL, wrR: hR, wr: hR, el: elR, sh: f.shR };
  }

  function drawFront(g, f, col) {
    leg(g, [f.footL, f.kneeL, f.hipL, f.hipR, f.kneeR, f.footR], col);
    trunk(g, f.hipC, f.shC, col);
    line(g, [f.shL, f.shR], col.ink, 9);
    headAt(g, f.hd, col.ink);
  }

  /* ---------- 動きの流れ ---------- */

  const DOWN_UP = [['下ろす', 2, 0, 1], ['上げる', 1, 1, 0]];
  const UP_DOWN = [['上げる', 1, 0, 1], ['下ろす', 2, 1, 0]];
  const PULL = [['引く', 1, 0, 1], ['戻す', 2, 1, 0]];
  const PUSH = [['押す', 1, 0, 1], ['戻す', 2, 1, 0]];
  /* 秒で数える種目。姿勢は変えず、吹き出しだけ順に出す */
  const KEEP = [['キープ', 2, 1, 1, 'a'], ['キープ', 2, 1, 1, 'b'], ['キープ', 2, 1, 1, 'c']];

  /* 動きの始まりと終わりで少し止める。止める局面と隣り合う側は足さない */
  function withPauses(phases) {
    const moving = p => p[2] !== p[3];
    const out = [];
    phases.forEach((p, i) => {
      const prev = phases[(i - 1 + phases.length) % phases.length];
      const next = phases[(i + 1) % phases.length];
      if (moving(p) && moving(prev)) out.push([p[0], PAUSE, p[2], p[2]]);
      out.push(p);
      if (moving(p) && moving(next)) out.push([p[0], PAUSE, p[3], p[3]]);
    });
    return out;
  }

  const C = (when, at, text) => ({ when: when, at: at, text: text });

  /* ---------- 種目 ---------- */
  /* 各種目は lv(難易度の段階、0から)を受け取り、{A, B, phases, cues, draw} を返す */

  const DEFS = {};

  // スクワット: 椅子に座って立つ / スクワット / 片脚を椅子に乗せて(ブルガリアン)
  DEFS.squat = lv => {
    if (lv >= 2) return bulgarian();
    if (lv === 0) {
      return {
        A: { shin: 90, thigh: 90, torso: 90, arm: -82 },
        B: { shin: 80, thigh: 176, torso: 62, arm: 0 },
        phases: [['座る', 2, 0, 1], ['立つ', 1, 1, 0]],
        cues: [
          C('座る', 'hip', 'お尻を後ろへ引いて座る'), C('座る', 'knee', '膝はつま先の向きへ'),
          C('立つ', 'ankle', 'かかとで床を押して立つ'), C('立つ', 'mid', '背中はまっすぐ'),
        ],
        draw(g, s, col) {
          floor(g, col);
          chair(g, 72, 46, col);
          const f = stand(pt(150, 4), s);
          const a2 = limbs(pt(f.sh.x - 4, f.sh.y), s.arm, s.arm);
          drawStand(g, f, col, { farArm: a2 });
          const a = limbs(f.sh, s.arm, s.arm);
          arm(g, [f.sh, a.el, a.wr], col);
          return Object.assign(f, a);
        },
      };
    }
    return {
      A: { shin: 90, thigh: 90, torso: 90, arm: -82 },
      B: { shin: 62, thigh: 168, torso: 52, arm: 4 },
      phases: DOWN_UP,
      cues: [
        C('下ろす', 'hip', 'お尻を後ろへ引く'), C('下ろす', 'ankle', 'かかとは床につけたまま'),
        C('上げる', 'knee', '膝はつま先の向きへ'), C('上げる', 'mid', '背中はまっすぐ'),
      ],
      draw(g, s, col) {
        floor(g, col);
        const f = stand(pt(150, 4), s);
        const a2 = limbs(pt(f.sh.x - 5, f.sh.y), s.arm, s.arm);
        drawStand(g, f, col, { farArm: a2 });
        const a = limbs(f.sh, s.arm, s.arm);
        arm(g, [f.sh, a.el, a.wr], col);
        return Object.assign(f, a);
      },
    };
  };

  function bulgarian() {
    const BENCH = { x: 52, w: 58, h: 44 };
    return {
      A: { shin: 86, thigh: 103, torso: 82 },
      B: { shin: 70, thigh: 168, torso: 70 },
      phases: DOWN_UP,
      cues: [
        C('下ろす', 'rknee', '後ろの膝は床の手前まで'), C('下ろす', 'ankle', '体重は前の脚に'),
        C('上げる', 'ankle', '前のかかとで押して立つ'), C('上げる', 'mid', '上体は少し前へ'),
      ],
      draw(g, s, col) {
        floor(g, col);
        box(g, BENCH.x, BENCH.h - 7, BENCH.w, 7, col.floor);
        box(g, BENCH.x + 4, 0, 5, BENCH.h - 7, col.floor);
        box(g, BENCH.x + BENCH.w - 9, 0, 5, BENCH.h - 7, col.floor);
        const f = stand(pt(176, 4), s);
        const rAnk = pt(BENCH.x + BENCH.w - 4, BENCH.h + 6);
        const rToe = pt(rAnk.x - L.foot, BENCH.h + 3);
        const rk = ik(f.hip, rAnk, L.thigh, L.shin, 1);
        leg(g, [f.hip, rk, rAnk, rToe], col, true);
        const a2 = limbs(pt(f.sh.x - 4, f.sh.y), -92, -88);
        arm(g, [pt(f.sh.x - 4, f.sh.y), a2.el, a2.wr], col, true);
        leg(g, [f.toe, f.ankle, f.knee, f.hip], col);
        trunk(g, f.hip, f.sh, col);
        headAt(g, f.hd, col.ink);
        const a = limbs(f.sh, -86, -82);
        arm(g, [f.sh, a.el, a.wr], col);
        return Object.assign(f, a, { rknee: rk });
      },
    };
  }

  // ヒップリフト: 両脚 / 片脚 / 片脚＋上で3秒止める
  DEFS.hip = lv => {
    const one = lv >= 1;
    const hold = lv >= 2;
    return {
      A: { torso: 3 },
      B: { torso: 35 },
      phases: hold ? [['上げる', 1, 0, 1], ['止める', 3, 1, 1], ['下ろす', 2, 1, 0]] : UP_DOWN,
      cues: hold ? [
        C('上げる', 'ankle', 'かかとで床を押す'),
        C('止める', 'mid', '肩から膝まで一直線'), C('止める', 'hip', 'お尻を締める'),
        C('下ろす', 'hip', '腰を反らさず、ゆっくり'),
      ] : [
        C('上げる', 'ankle', 'かかとで床を押す'), C('上げる', 'mid', '肩から膝まで一直線'),
        C('下ろす', 'hip', '腰を反らさず、ゆっくり'),
      ],
      draw(g, s, col) {
        floor(g, col);
        const sh = pt(92, 9);
        const hip = step(sh, L.torso, s.torso);
        const ankle = pt(206, 4);
        const toe = pt(ankle.x + L.foot, 0);
        const k = ik(hip, ankle, L.thigh, L.shin, 1);
        leg(g, [toe, ankle, k, hip], col, true);
        arm(g, [sh, pt(sh.x + 30, 5), pt(sh.x + 58, 4)], col);
        trunk(g, hip, sh, col);
        headAt(g, pt(sh.x - L.neck - L.head, L.head), col.ink);
        if (one) {
          const t = angle(hip, k);
          const k2 = step(hip, L.thigh, t), a2 = step(k2, L.shin, t);
          leg(g, [hip, k2, a2, step(a2, L.foot * 0.8, t + 70)], col);
        } else {
          leg(g, [pt(toe.x - 4, 0), pt(ankle.x - 4, ankle.y), pt(k.x - 4, k.y), hip], col);
        }
        return { hip: hip, knee: k, ankle: ankle, sh: sh, mid: mid(hip, sh) };
      },
    };
  };

  // カーフレイズ: 両脚 / 片脚 / 片脚＋段差に乗って
  DEFS.calf = lv => {
    const onStep = lv >= 2, one = lv >= 1;
    const STEP_H = 18;
    return {
      A: { a: onStep ? -18 : 0 },
      B: { a: 42 },
      phases: [['上げる', 1, 0, 1], ['止める', 1, 1, 1], ['下ろす', 2, 1, 0]],
      cues: [
        C('上げる', 'ankle', 'かかとを高く上げる'), C('上げる', 'knee', '膝は伸ばしたまま'),
        C('止める', 'ankle', '上で止める'),
        C('下ろす', 'ankle', onStep ? 'かかとを段差より下まで' : 'ゆっくり下ろす'),
      ],
      draw(g, s, col) {
        floor(g, col);
        const base = onStep ? STEP_H : 0;
        if (onStep) box(g, 168, 0, 70, STEP_H, col.floor);
        const toe = pt(182, base);
        const ankle = step(toe, L.foot, 180 - s.a);
        ankle.y += 5;
        const knee = pt(ankle.x + 2, ankle.y + L.shin);
        const hip = pt(ankle.x + 2, knee.y + L.thigh);
        const sh = step(hip, L.torso, 90);
        const hd = step(sh, L.neck + L.head, 90);
        if (one) {
          const fk = step(hip, L.thigh, -100), fa = step(fk, L.shin, 200);
          leg(g, [hip, fk, fa, step(fa, 12, 250)], col, true);
        } else {
          leg(g, [pt(toe.x - 5, toe.y), pt(ankle.x - 5, ankle.y), pt(knee.x - 5, knee.y), hip], col, true);
        }
        leg(g, [toe, ankle, knee, hip], col);
        trunk(g, hip, sh, col);
        headAt(g, hd, col.ink);
        const a = limbs(sh, -88, -86);
        arm(g, [sh, a.el, a.wr], col);
        return { ankle: ankle, knee: knee, hip: hip, sh: sh, mid: mid(hip, sh) };
      },
    };
  };

  // チューブ デッドリフト
  DEFS.tdead = () => ({
    A: { shin: 88, thigh: 92, torso: 88 },
    B: { shin: 76, thigh: 128, torso: 28 },
    phases: DOWN_UP,
    cues: [
      C('下ろす', 'hip', 'お尻を後ろへ引く'), C('下ろす', 'mid', '背中を丸めない'),
      C('上げる', 'ankle', 'かかとで床を押して立つ'), C('上げる', 'hip', 'お尻を前へ出しきる'),
    ],
    draw(g, s, col) {
      floor(g, col);
      const f = stand(pt(150, 4), s);
      const a = limbs(f.sh, -90, -90);
      band(g, pt(f.ankle.x + 4, 1), a.wr, col);
      drawStand(g, f, col);
      arm(g, [f.sh, a.el, a.wr], col);
      return Object.assign(f, a);
    },
  });

  // 腕立て: 壁に手をついて / ひざをついて / 腕立て / 足を台に乗せて
  DEFS.push = lv => {
    if (lv === 0) {
      const WALL = 212, HAND = pt(WALL - 2, 140), TOE = pt(100, 0);
      return {
        A: { t: 70 }, B: { t: 58 },
        phases: DOWN_UP,
        cues: [
          C('下ろす', 'mid', '体を一直線に保つ'), C('下ろす', 'el', '肘を曲げて胸を壁へ'),
          C('上げる', 'wr', '壁を押して戻る'), C('上げる', 'hip', '腰を曲げない'),
        ],
        draw(g, s, col) {
          floor(g, col);
          line(g, [pt(WALL + 4, 0), pt(WALL + 4, GROUND - 4)], col.floor, 6);
          const ankle = step(TOE, 8, s.t + 70);
          const knee = step(TOE, L.shin + 4, s.t);
          const hip = step(TOE, L.shin + L.thigh + 4, s.t);
          const sh = step(TOE, L.shin + L.thigh + L.torso + 4, s.t);
          const hd = step(sh, L.neck + L.head, s.t);
          const el = ik(sh, HAND, L.upper, L.fore, -1);
          leg(g, [pt(TOE.x - 5, 0), pt(ankle.x - 5, ankle.y), pt(knee.x - 5, knee.y), hip], col, true);
          leg(g, [TOE, ankle, knee, hip], col);
          trunk(g, hip, sh, col);
          headAt(g, hd, col.ink);
          arm(g, [sh, el, HAND], col);
          return { hip: hip, sh: sh, el: el, wr: HAND, mid: mid(hip, sh) };
        },
      };
    }
    const knees = lv === 1, decline = lv >= 3;
    const pivot = knees ? pt(115, 4) : decline ? pt(60, 40) : pt(70, 3);
    const len = knees ? L.thigh + L.torso : L.shin + L.thigh + L.torso;
    const top = Math.asin((60 - pivot.y) / len), bot = Math.asin((24 - pivot.y) / len);
    const HAND = pt(pivot.x + len * Math.cos(top) + 2, 2);
    return {
      A: { t: deg(top) }, B: { t: deg(bot) },
      phases: DOWN_UP,
      cues: [
        C('下ろす', 'hip', '頭から' + (knees ? '膝' : 'かかと') + 'まで一直線'), C('下ろす', 'el', '肘は45度くらいに引く'),
        C('上げる', 'wr', '床を押して戻る'), C('上げる', 'mid', '腰を落とさない'),
      ],
      draw(g, s, col) {
        floor(g, col);
        if (decline) box(g, 30, 0, 52, 38, col.floor);
        let hip, kneeP, ankle, toe;
        if (knees) {
          kneeP = pivot;
          ankle = pt(pivot.x - 40, 18); toe = pt(ankle.x - 8, 22);
          hip = step(pivot, L.thigh, s.t);
        } else {
          toe = pivot;
          ankle = step(pivot, 9, s.t + 60);
          kneeP = step(pivot, L.shin, s.t);
          hip = step(pivot, L.shin + L.thigh, s.t);
        }
        const sh = step(pivot, len, s.t);
        const hd = step(sh, L.neck + L.head, s.t + 4);
        const el = ik(sh, HAND, L.upper, L.fore, -1);
        leg(g, [toe, ankle, kneeP, hip], col);
        trunk(g, hip, sh, col);
        headAt(g, hd, col.ink);
        arm(g, [sh, el, HAND], col);
        return { hip: hip, sh: sh, el: el, wr: HAND, mid: mid(hip, sh) };
      },
    };
  };

  // パイクプッシュアップ: ひざをついて / 腰を高く上げて / 足を台に乗せて
  DEFS.pike = lv => {
    const onBox = lv >= 2;
    const HAND = pt(200, 2), FOOT = onBox ? pt(70, 42) : pt(95, 2);
    return {
      A: { sx: 172, sy: 56, ta: 145 },
      B: { sx: 186, sy: 24, ta: 122 },
      phases: DOWN_UP,
      cues: [
        C('下ろす', 'hd', '頭を床へ下ろす'), C('下ろす', 'hip', 'お尻は高いまま'),
        C('上げる', 'wr', '床を押して戻る'), C('上げる', 'sh', '肩で押し上げる'),
      ],
      draw(g, s, col) {
        floor(g, col);
        if (onBox) box(g, 40, 0, 52, 40, col.floor);
        const sh = pt(s.sx, s.sy);
        const hip = step(sh, L.torso, s.ta);
        const hd = step(sh, L.neck + L.head, s.ta + 180);
        const el = ik(sh, HAND, L.upper, L.fore, -1);
        const k = ik(hip, FOOT, L.thigh, L.shin, 1);
        leg(g, [pt(FOOT.x - 8, FOOT.y - 2), FOOT, k, hip], col);
        trunk(g, hip, sh, col);
        headAt(g, hd, col.ink);
        arm(g, [sh, el, HAND], col);
        return { hip: hip, sh: sh, el: el, wr: HAND, hd: hd, mid: mid(hip, sh) };
      },
    };
  };

  // チューブ チェストプレス(アンカーは背中側)
  DEFS.tpress = () => {
    const AN = pt(40, 142);
    return {
      A: { up: 205, fo: 0 }, B: { up: -4, fo: -4 },
      phases: PUSH,
      cues: [
        C('押す', 'wr', '両手を前へ押し出す'), C('押す', 'mid', '胸を張ったまま'),
        C('戻す', 'el', 'ゆっくり戻す'), C('戻す', 'hip', '腰を反らさない'),
      ],
      draw(g, s, col) {
        floor(g, col);
        anchor(g, AN, col);
        const f = stand(pt(166, 4), { shin: 96, thigh: 100, torso: 88 });
        const a = limbs(f.sh, s.up, s.fo);
        band(g, AN, a.wr, col);
        const fk = ik(f.hip, pt(f.hip.x - 36, 4), L.thigh, L.shin, -1);
        leg(g, [pt(f.hip.x - 30, 0), pt(f.hip.x - 36, 4), fk, f.hip], col, true);
        leg(g, [f.toe, f.ankle, f.knee, f.hip], col);
        trunk(g, f.hip, f.sh, col);
        headAt(g, f.hd, col.ink);
        arm(g, [f.sh, a.el, a.wr], col);
        return Object.assign(f, a);
      },
    };
  };

  // チューブ ショルダープレス(チューブを足で踏む)
  DEFS.tshoulder = () => ({
    A: { x: 42, y: 150 }, B: { x: 24, y: 206 },
    phases: PUSH,
    cues: [
      C('押す', 'wrR', '真上へ押し上げる'), C('押す', 'hipC', '腰を反らせない'),
      C('戻す', 'wrR', '肩の高さまでゆっくり'), C('戻す', 'elR', '肘は体の前へ'),
    ],
    draw(g, s, col) {
      floor(g, col);
      const f = front({ feet: 22 });
      const hL = pt(160 - s.x, s.y), hR = pt(160 + s.x, s.y);
      band(g, pt(f.footL.x, 1), hL, col);
      band(g, pt(f.footR.x, 1), hR, col);
      drawFront(g, f, col);
      return Object.assign(f, frontArms(g, f, hL, hR, col));
    },
  });

  // チューブ フレンチプレス(アンカーは上。肘を固定して下へ押す)
  DEFS.ttriceps = () => {
    const AN = pt(222, 200);
    return {
      A: { fo: 70 }, B: { fo: -86 },
      phases: PUSH,
      cues: [
        C('押す', 'el', '肘は体の横で動かさない'), C('押す', 'wr', '前腕だけで下へ押す'),
        C('戻す', 'wr', 'ゆっくり戻す'), C('戻す', 'mid', '背中はまっすぐ'),
      ],
      draw(g, s, col) {
        floor(g, col);
        anchor(g, AN, col);
        const f = stand(pt(150, 4), { shin: 88, thigh: 92, torso: 84 });
        const a = limbs(f.sh, -96, s.fo);
        band(g, AN, a.wr, col);
        drawStand(g, f, col);
        arm(g, [f.sh, a.el, a.wr], col);
        return Object.assign(f, a);
      },
    };
  };

  // チューブ ラットプルダウン(アンカーは一番上)
  DEFS.tlat = () => {
    const AN = pt(160, 210);                 // 頭の真上(画面に入る高さまで)
    return {
      A: { x: 54, y: 196 }, B: { x: 40, y: 148 },
      phases: PULL,
      cues: [
        C('引く', 'wrR', '胸の横へ引き下ろす'), C('引く', 'shR', '肩甲骨を下げる'),
        C('戻す', 'wrR', '腕が伸びるまでゆっくり'), C('戻す', 'hipC', '腰を反らせない'),
      ],
      draw(g, s, col) {
        floor(g, col);
        const [ax, ay] = P(AN);
        g.strokeStyle = col.floor; g.lineWidth = 4;
        g.beginPath(); g.moveTo(ax - 26, ay); g.lineTo(ax + 26, ay); g.stroke();
        const f = front({ feet: 22 });
        const hL = pt(160 - s.x, s.y), hR = pt(160 + s.x, s.y);
        band(g, AN, hL, col);
        band(g, AN, hR, col);
        drawFront(g, f, col);
        return Object.assign(f, frontArms(g, f, hL, hR, col));
      },
    };
  };

  // チューブ シーテッドロウ(長座で足裏に掛ける)
  DEFS.trow = () => ({
    A: { t: 82, up: -25, fo: -20 }, B: { t: 92, up: 195, fo: 0 },
    phases: PULL,
    cues: [
      C('引く', 'el', '肘をわき腹に沿わせて引く'), C('引く', 'mid', '胸を張ったまま'),
      C('戻す', 'wr', 'ゆっくり腕を伸ばす'), C('戻す', 'sh', '背中を丸めない'),
    ],
    draw(g, s, col) {
      floor(g, col);
      const hip = pt(100, 8);
      const knee = step(hip, L.thigh, 8), ankle = step(knee, L.shin, -10);
      const toe = step(ankle, L.foot, 80);
      const sh = step(hip, L.torso, s.t), hd = step(sh, L.neck + L.head, s.t);
      const a = limbs(sh, s.up, s.fo);
      band(g, pt(ankle.x + 4, ankle.y + 8), a.wr, col);
      leg(g, [pt(hip.x - 2, hip.y), pt(knee.x - 3, knee.y), pt(ankle.x - 3, ankle.y), pt(toe.x - 3, toe.y)], col, true);
      leg(g, [hip, knee, ankle, toe], col);
      trunk(g, hip, sh, col);
      headAt(g, hd, col.ink);
      arm(g, [sh, a.el, a.wr], col);
      return { hip: hip, knee: knee, ankle: ankle, sh: sh, mid: mid(hip, sh), el: a.el, wr: a.wr };
    },
  });

  // チューブ ベントオーバーロウ(チューブを踏み、上体を倒す)
  DEFS.tbrow = () => ({
    A: { up: -90, fo: -90 }, B: { up: 205, fo: -80 },
    phases: PULL,
    cues: [
      C('引く', 'wr', 'おへそへ引き上げる'), C('引く', 'mid', '背中を丸めない'),
      C('戻す', 'wr', 'ゆっくり腕を伸ばす'), C('戻す', 'knee', '膝は軽く曲げたまま'),
    ],
    draw(g, s, col) {
      floor(g, col);
      const f = stand(pt(150, 4), { shin: 80, thigh: 112, torso: 40 });
      const a = limbs(f.sh, s.up, s.fo);
      band(g, pt(f.ankle.x + 4, 1), a.wr, col);
      drawStand(g, f, col);
      arm(g, [f.sh, a.el, a.wr], col);
      return Object.assign(f, a);
    },
  });

  // チューブ プルアパート(正面から)
  DEFS.tapart = () => ({
    A: { x: 14 }, B: { x: 80 },
    phases: [['開く', 1, 0, 1], ['戻す', 2, 1, 0]],
    cues: [
      C('開く', 'wrR', '胸の前で左右へ開く'), C('開く', 'shC', '肩甲骨を寄せる'),
      C('戻す', 'wrL', 'ゆっくり戻す'), C('戻す', 'elR', '肘は伸ばしたまま'),
    ],
    draw(g, s, col) {
      floor(g, col);
      const f = front({ feet: 24 });
      const wrL = pt(160 - s.x, 146), wrR = pt(160 + s.x, 146);
      band(g, wrL, wrR, col);
      drawFront(g, f, col);
      return Object.assign(f, frontArms(g, f, wrL, wrR, col));
    },
  });

  // チューブ フェイスプル(アンカーは顔の高さ)
  DEFS.tface = () => {
    const AN = pt(160, 198);                 // 顔の高さ。正面から見ると体の手前なので、頭の上に出す
    return {
      A: { x: 15, y: 152 }, B: { x: 58, y: 176 },
      phases: PULL,
      cues: [
        C('引く', 'wrR', '顔の横へ引く'), C('引く', 'shR', '肩甲骨を寄せる'),
        C('引く', 'elR', '肘は肩より高く'),
        C('戻す', 'wrR', 'ゆっくり戻す'), C('戻す', 'hipC', '胸を張ったまま'),
      ],
      draw(g, s, col) {
        floor(g, col);
        const f = front({ feet: 22 });
        const hL = pt(160 - s.x, s.y), hR = pt(160 + s.x, s.y);
        band(g, AN, hL, col);
        band(g, AN, hR, col);
        drawFront(g, f, col);
        const a = frontArms(g, f, hL, hR, col);
        const [ax, ay] = P(AN);              // アンカーは手前にあるので点で示す
        g.fillStyle = col.accent; g.beginPath(); g.arc(ax, ay, 4, 0, Math.PI * 2); g.fill();
        return Object.assign(f, a);
      },
    };
  };

  // チューブ プルオーバー(アンカーは上。肘を伸ばしたまま下ろす)
  DEFS.tpullover = () => {
    const AN = pt(246, 204);
    return {
      A: { up: 55 }, B: { up: -72 },
      phases: PULL,
      cues: [
        C('引く', 'el', '肘を伸ばしたまま'), C('引く', 'wr', '腕を前へ下ろす'),
        C('戻す', 'wr', 'ゆっくり上へ戻す'), C('戻す', 'mid', '背中はまっすぐ'),
      ],
      draw(g, s, col) {
        floor(g, col);
        anchor(g, AN, col);
        const f = stand(pt(140, 4), { shin: 86, thigh: 98, torso: 80 });
        const a = limbs(f.sh, s.up, s.up);
        band(g, AN, a.wr, col);
        drawStand(g, f, col);
        arm(g, [f.sh, a.el, a.wr], col);
        return Object.assign(f, a);
      },
    };
  };

  /* プランク・サイドプランク共通。肘を肩の真下に置き、足(膝)から肩まで一直線。
   * sag は腰の落ち具合(1 で床につく) */
  function plankBody(g, col, knees, sag, liftLeg, topArm) {
    const SH = pt(212, 35);
    const pivot = knees ? pt(108, 4) : pt(58, 3);
    const t = angle(pivot, SH);
    const len = knees ? L.thigh : L.shin + L.thigh;
    const hipLine = step(pivot, len, t);
    const hip = pt(hipLine.x, lerp(hipLine.y, 9, sag));
    const el = pt(SH.x, 4), hand = pt(SH.x + 28, 4);
    const hd = step(SH, L.neck + L.head, t + 4);
    if (knees) {
      leg(g, [pt(pivot.x - 44, 12), pivot, hip], col);
    } else {
      const knee = ik(pivot, hip, L.shin, L.thigh, 1);
      leg(g, [pt(pivot.x - 6, 0), pivot, knee, hip], col, !!liftLeg);
      if (liftLeg) {
        const ang = angle(hip, pivot) - 12 * liftLeg;
        const k2 = step(hip, L.thigh, ang), a2 = step(k2, L.shin, ang);
        leg(g, [hip, k2, a2], col);
      }
    }
    trunk(g, hip, SH, col);
    headAt(g, hd, col.ink);
    arm(g, [SH, el, hand], col);
    if (topArm) arm(g, [SH, step(SH, L.upper, 92), step(step(SH, L.upper, 92), L.fore, 92)], col, true);
    return { hip: hip, sh: SH, el: el, mid: mid(hip, SH) };
  }

  // プランク: ひざをついて / プランク / 片脚を上げて
  DEFS.plank = lv => {
    const knees = lv === 0, lift = lv >= 2;
    const line1 = knees ? '頭から膝まで一直線' : '頭からかかとまで一直線';
    return {
      A: { lift: 0 }, B: { lift: 1 },
      phases: lift
        ? [['上げる', 1, 0, 1], ['キープ', 2, 1, 1, 'a'], ['キープ', 2, 1, 1, 'b'], ['キープ', 2, 1, 1, 'c'], ['下ろす', 1, 1, 0]]
        : KEEP,
      cues: [C('a', 'mid', line1), C('b', 'hip', '腰を反らせない'), C('c', 'el', '肘は肩の真下')],
      draw(g, s, col) {
        floor(g, col);
        return plankBody(g, col, knees, 0, lift ? s.lift : 0, false);
      },
    };
  };

  // サイドプランク: ひざをついて / サイドプランク(床から腰を持ち上げてキープ)
  DEFS.splank = lv => {
    const knees = lv === 0;
    return {
      A: { sag: 1 }, B: { sag: 0 },
      phases: [['上げる', 1, 0, 1], ['キープ', 2, 1, 1, 'a'], ['キープ', 2, 1, 1, 'b'], ['キープ', 2, 1, 1, 'c'], ['下ろす', 1, 1, 0]],
      cues: [
        C('a', 'mid', knees ? '頭から膝まで一直線' : '頭から足まで一直線'),
        C('b', 'hip', '腰を落とさない'), C('c', 'el', '肘は肩の真下'),
      ],
      draw(g, s, col) {
        floor(g, col);
        return plankBody(g, col, knees, s.sag, 0, true);
      },
    };
  };

  /* あお向け。頭が左、足が右。腕は床に沿わせる */
  function lying(g, col, armUp) {
    const sh = pt(86, 9), hip = pt(144, 8);
    if (!armUp) arm(g, [sh, pt(sh.x + 30, 5), pt(sh.x + 56, 4)], col);
    trunk(g, hip, sh, col);
    headAt(g, pt(sh.x - L.neck - L.head, L.head), col.ink);
    return { sh: sh, hip: hip, mid: mid(hip, sh) };
  }

  // レッグレイズ: ひざを曲げて / 脚を伸ばして / 床すれすれで止める
  DEFS.legraise = lv => {
    const bent = lv === 0, hover = lv >= 2;
    return {
      A: { a: bent ? 40 : hover ? 7 : 4 }, B: { a: 88 },
      phases: hover ? [['上げる', 1, 0, 1], ['下ろす', 2, 1, 0], ['止める', 1, 0, 0]] : UP_DOWN,
      cues: [
        C('上げる', 'hip', '腰を浮かせない'), C('上げる', 'ankle', '脚をそろえて上げる'),
        C('下ろす', 'ankle', 'ゆっくり下ろす'),
      ].concat(hover ? [C('止める', 'ankle', '床すれすれで止める')] : []),
      draw(g, s, col) {
        floor(g, col);
        const b = lying(g, col, false);
        const knee = step(b.hip, L.thigh, s.a);
        const ankle = bent ? step(knee, L.shin, s.a - 80) : step(knee, L.shin, s.a);
        const toe = step(ankle, 12, (bent ? s.a - 80 : s.a) + 90);
        leg(g, [pt(b.hip.x, b.hip.y), pt(knee.x - 4, knee.y), pt(ankle.x - 4, ankle.y)], col, true);
        leg(g, [b.hip, knee, ankle, toe], col);
        return Object.assign(b, { knee: knee, ankle: ankle });
      },
    };
  };

  // デッドバグ: 腕だけ / 腕と脚 / 脚を伸ばして。手前の腕と奥の脚(対角)を伸ばす
  DEFS.deadbug = lv => {
    const legs = lv >= 1, straight = lv >= 2;
    return {
      A: { arm: 90, th: 90, sn: straight ? 90 : 0 },
      B: { arm: 168, th: legs ? 16 : 90, sn: legs ? 16 : (straight ? 90 : 0) },
      phases: [['伸ばす', 2, 0, 1], ['戻す', 1, 1, 0]],
      cues: [
        C('伸ばす', 'hip', '腰を床につけたまま'),
        C('伸ばす', 'wr', legs ? '対角の手と脚をゆっくり伸ばす' : '腕をゆっくり頭の上へ'),
        C('戻す', 'mid', '腰を反らさない'),
      ],
      draw(g, s, col) {
        floor(g, col);
        const b = lying(g, col, true);
        // 奥の脚(動かす方)と、奥の腕(上げたまま)
        const fk = step(b.hip, L.thigh, s.th), fa = step(fk, L.shin, s.sn);
        leg(g, [b.hip, fk, fa], col, true);
        const fa2 = limbs(pt(b.sh.x - 3, b.sh.y), 90, 90);
        arm(g, [pt(b.sh.x - 3, b.sh.y), fa2.el, fa2.wr], col, true);
        // 手前の脚(曲げたまま)と、手前の腕(動かす方)
        const nk = step(b.hip, L.thigh, 90), na = step(nk, L.shin, straight ? 90 : 0);
        leg(g, [b.hip, nk, na], col);
        const a = limbs(b.sh, s.arm, s.arm);
        arm(g, [b.sh, a.el, a.wr], col);
        return Object.assign(b, a);
      },
    };
  };

  // 腹筋ローラー: ひざをついて半分 / ひざをついて / 立ちコロ
  DEFS.roller = lv => {
    const half = lv === 0;
    return {
      A: { th: 80, rx: 150 }, B: { th: half ? 48 : 25, rx: half ? 200 : 245 },
      phases: [['転がす', 2, 0, 1], ['戻す', 1, 1, 0]],
      cues: [
        C('転がす', 'wr', 'ゆっくり前へ'), C('転がす', 'hip', '腰が反る手前で止める'),
        C('戻す', 'mid', 'お腹に力を入れて戻す'), C('戻す', 'el', '腕は伸ばしたまま'),
      ],
      draw(g, s, col) {
        floor(g, col);
        const knee = pt(95, 4);
        const hip = step(knee, L.thigh, s.th);
        const hand = pt(s.rx, 18);
        const sh = ik(hip, hand, L.torso, ARM - 2, 1);
        const el = mid(sh, hand);
        const hd = step(sh, L.neck + L.head, angle(hip, sh));
        g.strokeStyle = col.far; g.lineWidth = 4;
        const [rx, ry] = P(pt(s.rx, 10));
        g.beginPath(); g.arc(rx, ry, 9, 0, Math.PI * 2); g.stroke();
        leg(g, [pt(knee.x - 44, 8), knee, hip], col);
        trunk(g, hip, sh, col);
        headAt(g, hd, col.ink);
        arm(g, [sh, el, hand], col);
        return { hip: hip, sh: sh, el: el, wr: hand, mid: mid(hip, sh) };
      },
    };
  };

  // チューブ ウッドチョップ(正面から。斜め上から斜め下へ)
  DEFS.tchop = () => {
    const AN = pt(282, 206);
    return {
      A: { x: 236, y: 194 }, B: { x: 104, y: 70 },
      phases: [['振る', 1, 0, 1], ['戻す', 2, 1, 0]],
      cues: [
        C('振る', 'wr', '斜め下へひねる'), C('振る', 'elR', '腕は伸ばしたまま'),
        C('戻す', 'wr', 'ゆっくり戻す'), C('戻す', 'footR', '足は踏ん張ったまま'),
      ],
      draw(g, s, col) {
        floor(g, col);
        line(g, [pt(AN.x + 4, 0), pt(AN.x + 4, GROUND - 4)], col.floor, 4);
        const hand = pt(s.x, s.y);
        const f = front({ feet: 32, lean: (s.x - 160) * 0.12 });
        const elL = ik(f.shL, hand, L.upper, L.fore, -1);
        const elR = ik(f.shR, hand, L.upper, L.fore, 1);
        band(g, AN, hand, col);
        drawFront(g, f, col);
        arm(g, [f.shL, elL, hand], col);
        arm(g, [f.shR, elR, hand], col);
        return Object.assign(f, { wr: hand, elR: elR });
      },
    };
  };

  /* ---------- 再生 ---------- */

  function colors() {
    const cs = getComputedStyle(document.documentElement);
    const v = n => cs.getPropertyValue(n).trim();
    return {
      ink: v('--ink'), far: v('--ink-sub'), floor: v('--line'), accent: v('--accent'),
      card: v('--card'), font: getComputedStyle(document.body).fontFamily,
    };
  }

  /* 関節に点を打ち、線を引いた先にポイントを書く。置き場所は関節の横で、
   * 体の中心から離れる側。先に置いた吹き出しと重なるときは上下にずらす */
  function cue(g, J, c, col, placed) {
    const at = J[c.at];
    if (!at) return;
    const [x, y] = P(at);
    g.font = '700 12px ' + col.font;
    const w = g.measureText(c.text).width + 14, h = 22;
    const cx = J.mid ? P(J.mid)[0] : W / 2;
    const right = x === cx ? x < W / 2 : x > cx;
    let bx = right ? x + 26 : x - 26 - w;
    if (bx < 4 || bx + w > W - 4) bx = right ? x - 26 - w : x + 26;   // 入らなければ反対側
    bx = Math.max(4, Math.min(W - w - 4, bx));
    let by = Math.max(4, Math.min(H - h - 4, y - 24 - h / 2));
    for (let n = 0; n < 4 && placed.some(r => bx < r.x + r.w && r.x < bx + w && by < r.y + r.h && r.y < by + h); n++) {
      by = by > H / 2 ? by - h - 6 : by + h + 6;
      by = Math.max(4, Math.min(H - h - 4, by));
    }
    placed.push({ x: bx, y: by, w: w, h: h });
    g.strokeStyle = col.accent; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(x, y); g.lineTo(bx + w / 2, by + h / 2); g.stroke();
    g.fillStyle = col.accent; g.beginPath(); g.arc(x, y, 4.5, 0, Math.PI * 2); g.fill();
    g.fillStyle = col.card; g.strokeStyle = col.accent;
    g.beginPath();
    if (g.roundRect) g.roundRect(bx, by, w, h, 11); else g.rect(bx, by, w, h);
    g.fill(); g.stroke();
    g.fillStyle = col.ink; g.textBaseline = 'middle';
    g.fillText(c.text, bx + 7, by + h / 2 + 1);
  }

  function frameOf(phases, cycle, sec) {
    let t = ((sec % cycle) + cycle) % cycle;
    for (const p of phases) {
      const [name, len, a, b, tag] = p;
      if (t < len) {
        return {
          p: lerp(a, b, ease(t / len)), tag: tag || name,
          label: name === '止める' ? '止める ' + Math.ceil(len - t) : name,
        };
      }
      t -= len;
    }
    return { p: 0, tag: '', label: '' };
  }

  /* sec 秒目の1枚を描く。局面の名前と、出している吹き出しの番号を返す */
  function render(g, def, sec) {
    const col = colors();
    const f = frameOf(def.phases, def.cycle, sec);
    const J = def.draw(g, lerpPose(def.A, def.B, f.p), col) || {};
    const placed = [], on = [];
    def.cues.forEach((c, i) => { if (c.when === f.tag) { cue(g, J, c, col, placed); on.push(i); } });
    return { label: f.label, on: on };
  }

  /* 種目と段階から、再生できる形にして返す。無ければ null */
  function make(key, lv) {
    const f = DEFS[key];
    if (!f) return null;
    const d = f(Number(lv) || 0);
    d.phases = withPauses(d.phases);
    d.cycle = d.phases.reduce((n, p) => n + p[1], 0);
    return d;
  }

  const reduce = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

  /* canvas に描き続ける。onFrame({label, on}) で、局面の名前と出ている吹き出しの番号を返す */
  function Player(cv, def, onFrame) {
    const r = window.devicePixelRatio || 1;
    cv.width = W * r; cv.height = H * r;
    const g = cv.getContext('2d');
    g.setTransform(r, 0, 0, r, 0, 0);
    this.playing = !reduce;
    this.speed = 1;
    let held = 0, last = performance.now(), raf = 0;
    const loop = now => {
      const dt = Math.min(0.1, (now - last) / 1000);   // 裏に回っていた間は飛ばさない
      last = now;
      if (this.playing) held += dt * this.speed;
      const f = render(g, def, held);
      if (onFrame) onFrame(f);
      raf = requestAnimationFrame(loop);
    };
    // 最初の1枚はすぐ描く(止めたままでも絵が出るように)
    const f0 = render(g, def, 0);
    if (onFrame) onFrame(f0);
    raf = requestAnimationFrame(loop);
    this.stop = () => cancelAnimationFrame(raf);
  }

  window.Anime = {
    has: key => !!DEFS[key],
    keys: () => Object.keys(DEFS),
    make: make,
    Player: Player,
    frameOf: frameOf,
  };
})();
