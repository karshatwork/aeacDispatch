/**
 * Dispatch Staging Bay — Warehouse Animation  (v2 "Cinematic")
 * ---------------------------------------------------------------------------
 * Drop-in replacement for the old dispatch-animation.js. Same public API:
 *   mount(container) · render({allocatedBoxes, scannedBoxes, isComplete})
 *   triggerScanEffect() · triggerDeparture() -> Promise · reset()
 *
 * The scene (left -> right):
 *   PILE of boxes  ->  WORKER lifts a box onto the  ->  CONVEYOR  ->  SCAN GATE
 *   ->  box queues at the end of the belt  ->  FORKLIFT picks it up, turns,
 *   drives into the  ->  OPEN TRUCK  and stacks it.  On "complete" the load is
 *   strapped down; triggerDeparture() drives the truck away.
 *
 * Design notes
 *  - Everything lives on a fixed 1280x480 virtual stage that is CSS-scaled to
 *    the container width, so nothing can clip or reflow at any screen size.
 *  - Boxes may be scanned in ANY order and in bursts. render() diffs the new
 *    scanned ids against what it already knows, queues one animation job per
 *    new box, and the worker/belt/forklift pipeline plays them back-to-back
 *    (auto speeds up when a backlog builds, snaps instantly when huge).
 *  - render() is idempotent. First render / new session / page reload /
 *    hidden tab => the scene is rebuilt instantly (no replay of old scans).
 *  - Zero dependencies. Styles + DOM are injected automatically.
 */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.dispatchAnimation = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ======================================================================
     CONSTANTS  (virtual stage coordinates, y grows downward)
     ====================================================================== */
  const W = 1280, H = 480;
  const Y0 = 392;                 // floor line (wheels / feet touch here)
  const BELT_Y = 304;             // top of conveyor belt (box bottoms rest here)
  const START_X = 304;            // belt: where the worker drops a box (box front-left x)
  const GATE_X = 374;             // belt: scan gate stop
  const SLOT_X = [584, 514, 444]; // belt: queue slots at the pickup end (slot 0 = pickup)
  const GCX = GATE_X + 28;        // gate centre x
  const PARK_X = 700, ENGAGE_X = 644, TURN_X = 780;   // forklift carriage x positions
  const FORK_LEN = 58;
  const BED_L = 776, XR = 1166;   // truck bed usable span for cargo
  const PILE_R = 204, PILE_SC = 0.78, PILE_COL_W = 44, PILE_ROW_H = 42 * PILE_SC, PILE_MAX = 12;
  const PICK_X = 246, PLACE_X = 282;                  // worker stand positions
  const MAX_ON_BELT = 4, MAX_BACKLOG = 14, MAX_CELLS = 60;

  /* ======================================================================
     STYLES
     ====================================================================== */
  const STYLES = `
.dsb-root{position:relative;width:100%;margin-bottom:16px;border-radius:var(--border-radius,8px);overflow:hidden;background:#0a1020;border:1px solid #1e2a44;box-shadow:0 12px 32px rgba(2,6,23,.38);line-height:0;user-select:none;-webkit-user-select:none}
.dsb-viewport{position:relative;width:100%;padding-top:37.5%;overflow:hidden;contain:paint}
.dsb-stage{position:absolute;left:0;top:0;width:1280px;height:480px;transform-origin:0 0;font-family:var(--font-mono,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace);line-height:1.2}
.dsb-layer{position:absolute;left:0;top:0;width:1280px;height:480px;pointer-events:none}
.dsb-ent{position:absolute;left:0;top:0;width:0;height:0;transform-origin:0 0;pointer-events:none;will-change:transform}
.dsb-box{position:absolute;left:0;top:0;width:66px;height:52px;transform-origin:0 0;pointer-events:none;will-change:transform}
.dsb-box svg{display:block;overflow:visible}
.dsb-box .dsb-chk{opacity:0;transition:opacity .25s}
.dsb-box.ok .dsb-chk{opacity:1}
.dsb-cell{will-change:auto}
.dsb-pbox{transition:transform .45s cubic-bezier(.2,.8,.2,1)}
.dsb-fade{animation:dsb-fade .45s ease-out}
@keyframes dsb-fade{from{opacity:0}to{opacity:1}}
.dsb-cnt{position:absolute;right:12px;top:14px;font:800 15px/1 var(--font-mono,monospace);color:#fff;background:rgba(15,23,42,.8);border-radius:6px;padding:2px 4px}

/* belt */
.dsb-beltf{position:absolute;left:300px;top:304px;width:352px;height:12px;background:repeating-linear-gradient(90deg,#2b3544 0 11px,#52627d 11px 14px,#2b3544 14px 24px);animation:dsb-belt .7s linear infinite;box-shadow:inset 0 2px 0 rgba(255,255,255,.14)}
.dsb-beltt{position:absolute;left:300px;top:294px;width:362px;height:10px;background:repeating-linear-gradient(90deg,#3a465b 0 11px,#5b6c88 11px 14px,#3a465b 14px 24px);clip-path:polygon(0 100%,10px 0,100% 0,calc(100% - 10px) 100%);animation:dsb-belt .7s linear infinite}
@keyframes dsb-belt{to{background-position:24px 0}}

/* scan gate */
.dsb-sweepg{animation:dsb-sweep 1.8s ease-in-out infinite alternate}
@keyframes dsb-sweep{from{transform:translateY(0)}to{transform:translateY(-124px)}}
.dsb-gantry.scanning .dsb-sweepg{animation:dsb-sweepf .56s ease-in-out 1}
@keyframes dsb-sweepf{0%{transform:translateY(0)}50%{transform:translateY(-124px)}100%{transform:translateY(0)}}
.dsb-curt{fill:rgba(56,189,248,.10);stroke:rgba(56,189,248,.55);stroke-width:1.5;stroke-dasharray:5 4;transition:fill .15s,stroke .15s}
.dsb-beam{stroke:#38bdf8;stroke-width:2.5;filter:drop-shadow(0 0 5px #38bdf8)}
.dsb-gantry.scanning .dsb-curt{fill:rgba(250,204,21,.16);stroke:rgba(250,204,21,.8)}
.dsb-gantry.scanning .dsb-beam{stroke:#fde047;filter:drop-shadow(0 0 7px #facc15)}
.dsb-gantry.hit .dsb-curt,.dsb-gantry.ping .dsb-curt{fill:rgba(52,211,153,.30);stroke:#34d399}
.dsb-gantry.hit .dsb-beam,.dsb-gantry.ping .dsb-beam{stroke:#6ee7b7;filter:drop-shadow(0 0 9px #10b981)}
.dsb-led{fill:#10b981;filter:drop-shadow(0 0 4px #10b981);animation:dsb-led 1.4s ease-in-out infinite}
.dsb-gantry.scanning .dsb-led{fill:#facc15}
.dsb-gantry.hit .dsb-led,.dsb-gantry.ping .dsb-led{fill:#6ee7b7}
@keyframes dsb-led{50%{opacity:.35}}
.dsb-ring{position:absolute;left:402px;top:234px;width:90px;height:90px;border-radius:50%;border:3px solid #34d399;box-shadow:0 0 18px #34d399;animation:dsb-ring .8s ease-out forwards;pointer-events:none}
@keyframes dsb-ring{from{transform:translate(-50%,-50%) scale(.25);opacity:.9}to{transform:translate(-50%,-50%) scale(2.3);opacity:0}}
.dsb-toast{position:absolute;left:402px;top:112px;transform:translateX(-50%);white-space:nowrap;background:#047857;color:#ecfdf5;border:2px solid #6ee7b7;border-radius:6px;padding:4px 10px;font-size:13px;font-weight:800;letter-spacing:.06em;box-shadow:0 6px 18px rgba(16,185,129,.45);animation:dsb-toast 1.4s ease-out forwards}
@keyframes dsb-toast{0%{opacity:0;transform:translate(-50%,12px) scale(.8)}14%{opacity:1;transform:translate(-50%,0) scale(1)}80%{opacity:1}100%{opacity:0;transform:translate(-50%,-14px)}}

/* HUD */
.dsb-hud{position:absolute;top:8px;display:flex;flex-direction:column;align-items:center;transform:translateX(-50%) scale(var(--hk,1));transform-origin:top center}
.dsb-chain{width:46px;height:12px;border-left:2px solid #64748b;border-right:2px solid #64748b;transform:perspective(40px) rotateX(-20deg)}
.dsb-sign{display:flex;align-items:center;gap:9px;padding:6px 11px;background:rgba(8,13,28,.86);border:1px solid rgba(148,163,184,.38);border-radius:8px;box-shadow:0 8px 18px rgba(0,0,0,.45)}
.dsb-sign-t{font-size:12px;font-weight:800;letter-spacing:.12em;color:#cbd5e1;white-space:nowrap}
.dsb-chip{font-size:11px;font-weight:800;padding:2px 9px;border-radius:999px;letter-spacing:.06em;border:1px solid;white-space:nowrap}
.dsb-chip-blue{background:rgba(14,165,233,.16);color:#7dd3fc;border-color:rgba(56,189,248,.5)}
.dsb-chip-green{background:rgba(16,185,129,.18);color:#6ee7b7;border-color:rgba(52,211,153,.55)}
.dsb-chip-amber{background:rgba(245,158,11,.18);color:#fcd34d;border-color:rgba(251,191,36,.55)}
.dsb-prog{width:78px;height:6px;border-radius:3px;background:rgba(148,163,184,.28);overflow:hidden}
.dsb-prog i{display:block;height:100%;width:0;background:linear-gradient(90deg,#10b981,#6ee7b7);transition:width .5s}
.dsb-progt{font-size:11px;font-weight:800;color:#94a3b8;min-width:42px}
.dsb-more{position:absolute;left:24px;top:244px;font-size:11px;font-weight:800;letter-spacing:.06em;color:#fcd34d;background:rgba(8,13,28,.8);border:1px dashed rgba(251,191,36,.6);border-radius:5px;padding:2px 7px;opacity:0;transition:opacity .3s}
.dsb-more.on{opacity:1}

/* truck */
.dsb-tail{fill:#7f1d1d;transition:fill .2s}
.dsb-tbeacon{fill:#92400e;transition:fill .2s}
.dsb-truck.revving .dsb-tail,.dsb-truck.driving .dsb-tail{fill:#ef4444;filter:drop-shadow(0 0 6px #ef4444)}
.dsb-truck.reversing .dsb-tail{fill:#f8fafc;filter:drop-shadow(0 0 6px #f8fafc)}
.dsb-truck.revving .dsb-tbeacon,.dsb-truck.driving .dsb-tbeacon,.dsb-truck.reversing .dsb-tbeacon{fill:#fbbf24;animation:dsb-blink .5s steps(2) infinite}
@keyframes dsb-blink{50%{opacity:.25}}
.dsb-truck.driving .dsb-tw{animation:dsb-spin .4s linear infinite;transform-box:fill-box;transform-origin:center}
.dsb-truck.reversing .dsb-tw{animation:dsb-spin .6s linear infinite reverse;transform-box:fill-box;transform-origin:center}
@keyframes dsb-spin{to{transform:rotate(360deg)}}
.dsb-truck.revving{animation:dsb-rumble .12s linear infinite}
@keyframes dsb-rumble{0%{margin-top:0}50%{margin-top:1px}}
.dsb-wrap{position:absolute;opacity:0;transform:scaleY(.15);transform-origin:50% 100%;transition:opacity .5s,transform .8s cubic-bezier(.2,.9,.2,1);pointer-events:none;border:2px solid rgba(110,231,183,.95);border-radius:6px;background:repeating-linear-gradient(45deg,rgba(110,231,183,.14) 0 6px,transparent 6px 14px),repeating-linear-gradient(-45deg,rgba(110,231,183,.14) 0 6px,transparent 6px 14px);box-shadow:0 0 26px rgba(52,211,153,.4),inset 0 0 22px rgba(52,211,153,.22)}
.dsb-wrap.on{opacity:1;transform:none}
.dsb-strap{position:absolute;top:-5px;bottom:0;width:7px;background:repeating-linear-gradient(0deg,#facc15 0 8px,#111827 8px 11px);box-shadow:0 0 6px rgba(250,204,21,.6)}
.dsb-ready{position:absolute;display:flex;align-items:center;gap:8px;white-space:nowrap;padding:7px 14px;background:#059669;color:#fff;border:2px solid #a7f3d0;border-radius:6px;font-size:13px;font-weight:800;letter-spacing:.08em;box-shadow:0 8px 22px rgba(5,150,105,.5);opacity:0;transform:translate(-50%,10px) scale(.88);transition:opacity .4s,transform .5s cubic-bezier(.175,.885,.32,1.275);transition-delay:.35s}
.dsb-ready.on{opacity:1;transform:translate(-50%,0) scale(1)}
.dsb-ready svg{width:16px;height:16px}

/* ambient */
.dsb-lamp{animation:dsb-lamp 7s ease-in-out infinite}
@keyframes dsb-lamp{50%{opacity:.78}}
.dsb-fkbeacon{animation:dsb-blink .9s steps(2) infinite;filter:drop-shadow(0 0 5px #fbbf24)}
@media (prefers-reduced-motion:reduce){.dsb-beltf,.dsb-beltt,.dsb-sweepg,.dsb-lamp,.dsb-led,.dsb-fkbeacon{animation:none}}
`;

  /* ======================================================================
     STATE
     ====================================================================== */
  const ABORT = { aborted: true };
  const noop = function () {};
  const S = {
    mounted: false, init: false, epoch: 0, speed: 1, ro: null,
    dom: {},
    alloc: [], allocMap: new Map(), allocKey: '', scannedModel: new Set(),
    picked: 0, placed: 0, layout: null,
    pile: [], cells: [], jobs: [], convQueue: [], convCount: 0,
    workerBusy: false, forkBusy: false, startOcc: false, gateOcc: false,
    wantComplete: false,
    departing: false, depP: null, truckAway: false, arriving: false,
    pendingRender: null, pendingReset: false,
    WK: { x: PLACE_X, f: 1, crouch: 0, hx: 12, hy: -48, phase: 0, amp: 0, held: null, hsc: 1 },
    FK: { x: PARK_X, f: -1, lift: 82, odo: 0, lastX: PARK_X, held: null }
  };

  /* ======================================================================
     SMALL HELPERS
     ====================================================================== */
  const ease = {
    io: t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    out: t => 1 - Math.pow(1 - t, 3),
    lin: t => t
  };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function runSafe(fn) {
    let p;
    try { p = fn(); } catch (e) { if (e !== ABORT) console.error(e); return; }
    if (p && p.catch) p.catch(e => { if (e !== ABORT) console.error(e); });
  }
  function bumpSpeed() {
    const n = S.jobs.length + Math.max(0, S.convCount - 1);
    S.speed = n <= 1 ? 1 : n === 2 ? 1.25 : n === 3 ? 1.6 : n <= 5 ? 2.1 : n <= 8 ? 2.8 : 3.6;
  }
  function tween(ms, step, easing) {
    const E = S.epoch, d = Math.max(1, ms / (S.speed || 1)), fn = easing || ease.io;
    return new Promise((res, rej) => {
      const t0 = performance.now();
      (function frame(now) {
        if (E !== S.epoch) return rej(ABORT);
        const p = Math.max(0, Math.min(1, (now - t0) / d));
        step(fn(p), p);
        if (p < 1) requestAnimationFrame(frame); else res();
      })(t0);
    });
  }
  function to(obj, target, ms, easing, apply) {
    const from = {};
    for (const k in target) from[k] = obj[k];
    return tween(ms, e => {
      for (const k in target) obj[k] = from[k] + (target[k] - from[k]) * e;
      if (apply) apply();
    }, easing);
  }
  function sleep(ms) {
    const E = S.epoch;
    return new Promise((res, rej) => setTimeout(() => (E === S.epoch ? res() : rej(ABORT)), ms / (S.speed || 1)));
  }
  function waitUntil(cond) {
    const E = S.epoch;
    return new Promise((res, rej) => {
      (function poll() {
        if (E !== S.epoch) return rej(ABORT);
        if (cond()) return res();
        setTimeout(poll, 60);
      })();
    });
  }
  const wait = ms => new Promise(r => setTimeout(r, ms));          // real-time, not epoch bound
  function isIdle() { return !S.jobs.length && !S.workerBusy && !S.convCount && !S.forkBusy; }

  /* 2-bone inverse kinematics. returns elbow/knee + (clamped) end point */
  function ik(sx, sy, tx, ty, a, b, sign) {
    const dx = tx - sx, dy = ty - sy, d = Math.hypot(dx, dy);
    const dd = Math.min(a + b - 0.5, Math.max(Math.abs(a - b) + 0.5, d));
    const base = Math.atan2(dy, dx);
    const A = Math.acos(Math.max(-1, Math.min(1, (a * a + dd * dd - b * b) / (2 * a * dd))));
    const ang = base + sign * A;
    return { ex: sx + a * Math.cos(ang), ey: sy + a * Math.sin(ang), hx: sx + Math.cos(base) * dd, hy: sy + Math.sin(base) * dd };
  }

  /* ======================================================================
     STATIC ART
     ====================================================================== */
  function boxSVG(info, variant) {
    const fills = ['#c98a45', '#bf7f3a', '#d39650'];
    const front = fills[(variant || 0) % 3];
    let sticker;
    if (info) {
      const b = '#' + info.batch, q = info.qty + 'P';
      const tl = s => (s.length > 6 ? ` textLength="${Math.min(38, s.length * 5.2).toFixed(1)}" lengthAdjust="spacingAndGlyphs"` : '');
      sticker =
        `<rect x="6" y="27" width="44" height="21" rx="2" fill="#fffdf6" stroke="#d6c9a8" stroke-width=".6"/>` +
        `<text x="28" y="37.6" text-anchor="middle" font-size="9.6" font-weight="800" fill="#1e293b" font-family="monospace"${tl(b)}>${esc(b)}</text>` +
        `<text x="28" y="45.6" text-anchor="middle" font-size="7.8" font-weight="800" fill="#b45309" font-family="monospace"${tl(q)}>${esc(q)}</text>`;
    } else {
      sticker =
        `<rect x="8" y="30" width="26" height="14" rx="1.5" fill="#f8f3e4"/>` +
        [11, 14, 16, 20, 22, 26, 29].map((x, i) => `<rect x="${x}" y="33" width="${i % 2 ? 1.2 : 2}" height="8" fill="#334155"/>`).join('');
    }
    return `<svg viewBox="0 0 66 52" width="66" height="52" xmlns="http://www.w3.org/2000/svg">` +
      `<polygon points="0,10 10,0 66,0 56,10" fill="#efc88f"/>` +
      `<polygon points="56,10 66,0 66,42 56,52" fill="#9c5f27"/>` +
      `<rect y="10" width="56" height="42" fill="${front}"/>` +
      `<rect y="10" width="56" height="3" fill="rgba(255,255,255,.22)"/>` +
      `<rect y="10" width="56" height="42" fill="none" stroke="#7a4a1c" stroke-width=".9"/>` +
      `<polygon points="23,10 33,0 41,0 31,10" fill="#f6e3b8"/>` +
      `<rect x="23" y="10" width="8" height="42" fill="#f1d9a5" opacity=".88"/>` +
      sticker +
      `<g class="dsb-chk"><circle cx="47" cy="19" r="7.5" fill="#10b981" stroke="#fff" stroke-width="1.4"/><path d="M43.4,19.2 l2.6,2.8 l5-5.6" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></g>` +
      `</svg>`;
  }

  function bgSVG() {
    let s = `<svg class="dsb-layer" style="z-index:1" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><defs>` +
      `<linearGradient id="dsb-g-wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0a1020"/><stop offset=".5" stop-color="#14203a"/><stop offset="1" stop-color="#1c2a47"/></linearGradient>` +
      `<linearGradient id="dsb-g-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#16244a"/><stop offset=".5" stop-color="#4b3b78"/><stop offset=".8" stop-color="#d9775f"/><stop offset="1" stop-color="#f7b267"/></linearGradient>` +
      `<linearGradient id="dsb-g-cone" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff1c9" stop-opacity=".30"/><stop offset="1" stop-color="#fff1c9" stop-opacity="0"/></linearGradient>` +
      `<linearGradient id="dsb-g-floor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2d3a52"/><stop offset="1" stop-color="#161e30"/></linearGradient>` +
      `<pattern id="dsb-haz" width="16" height="16" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="16" fill="#f59e0b"/><rect x="8" width="8" height="16" fill="#111827"/></pattern>` +
      `</defs>`;
    s += `<rect width="${W}" height="${Y0}" fill="url(#dsb-g-wall)"/>`;
    for (let x = 0; x <= W; x += 80) s += `<line x1="${x}" y1="46" x2="${x}" y2="${Y0}" stroke="rgba(255,255,255,.035)"/>`;
    s += `<rect y="330" width="752" height="62" fill="rgba(0,0,0,.28)"/><rect y="328" width="752" height="3" fill="#f59e0b" opacity=".5"/>`;
    // windows
    [170, 470].forEach(x => {
      s += `<g transform="translate(${x},92)"><rect width="110" height="66" rx="3" fill="url(#dsb-g-sky)" opacity=".78"/><path d="M55,0V66M0,33H110" stroke="#0b1220" stroke-width="4"/><rect width="110" height="66" rx="3" fill="none" stroke="#2f4270" stroke-width="3"/></g>`;
    });
    // dim racks behind the scanner
    s += `<g opacity=".28">`;
    [560, 650, 740].forEach(x => { s += `<rect x="${x}" y="130" width="6" height="200" fill="#2a3b66"/>`; });
    [170, 230, 290].forEach((y, r) => {
      s += `<rect x="560" y="${y}" width="186" height="6" fill="#2a3b66"/>`;
      for (let k = 0; k < 5; k++) s += `<rect x="${570 + k * 34}" y="${y - 22 + ((k + r) % 3) * 4}" width="26" height="${22 - ((k + r) % 3) * 4}" fill="#3a4f80"/>`;
    });
    s += `</g>`;
    // wall sign
    s += `<g transform="translate(530,80)"><rect width="190" height="26" rx="4" fill="#0b1220" stroke="#2f4270"/><text x="95" y="18" text-anchor="middle" font-size="13" font-weight="800" letter-spacing="3" fill="#fbbf24" font-family="monospace">DISPATCH BAY</text></g>`;
    // dock opening w/ dusk sky
    s += `<rect x="752" y="68" width="528" height="${Y0 - 68}" fill="url(#dsb-g-sky)"/>`;
    s += `<circle cx="1120" cy="132" r="30" fill="#fde9b8" opacity=".12"/><circle cx="1120" cy="132" r="17" fill="#fde9b8" opacity=".92"/>`;
    for (let i = 0; i < 26; i++) s += `<circle cx="${760 + ((i * 97) % 520)}" cy="${76 + ((i * 53) % 100)}" r="${i % 3 ? 0.9 : 1.4}" fill="#fff" opacity="${0.35 + (i % 4) * 0.12}"/>`;
    let bx = 752, sky = '';
    for (let i = 0; bx < W; i++) {
      const bw = 34 + ((i * 29) % 46), bh = 60 + ((i * 47) % 120);
      sky += `<rect x="${bx}" y="${Y0 - bh}" width="${bw}" height="${bh}" fill="#0b1328"/>`;
      for (let wy = Y0 - bh + 10; wy < Y0 - 14; wy += 16) for (let wx = bx + 6; wx < bx + bw - 8; wx += 11) if (((wx * 7 + wy * 3) | 0) % 5 < 2) sky += `<rect x="${wx}" y="${wy}" width="4" height="6" fill="#fcd34d" opacity=".75"/>`;
      bx += bw + 3;
    }
    s += sky;
    s += `<rect x="752" y="${Y0 - 40}" width="528" height="40" fill="#0a1022" opacity=".55"/>`;
    s += `<rect x="738" y="44" width="542" height="26" fill="#111a30"/><rect x="738" y="60" width="542" height="10" fill="url(#dsb-haz)" opacity=".9"/><rect x="736" y="44" width="20" height="${Y0 - 44}" fill="#1b2744" stroke="#2f4270"/>`;
    s += `<rect x="736" y="${Y0 - 70}" width="20" height="70" fill="url(#dsb-haz)" opacity=".85"/>`;
    // ceiling, trusses, lamps
    s += `<rect width="${W}" height="46" fill="#070b16"/><line x1="0" y1="8" x2="${W}" y2="8" stroke="#1d2b4a" stroke-width="3"/><line x1="0" y1="45" x2="${W}" y2="45" stroke="#2a3c66" stroke-width="3"/>`;
    let tr = 'M0,45'; for (let x = 0; x <= W; x += 40) tr += ` L${x + 20},8 L${x + 40},45`;
    s += `<path d="${tr}" fill="none" stroke="#1b2845" stroke-width="2"/>`;
    [120, 380, 640, 900, 1160].forEach(x => {
      s += `<polygon class="dsb-lamp" points="${x - 18},76 ${x + 18},76 ${x + 140},${Y0} ${x - 140},${Y0}" fill="url(#dsb-g-cone)"/>`;
      s += `<line x1="${x}" y1="45" x2="${x}" y2="58" stroke="#475569" stroke-width="2"/><path d="M${x - 26},72 L${x + 26},72 L${x + 16},58 L${x - 16},58 Z" fill="#111a2e" stroke="#2c3b5c"/><rect x="${x - 19}" y="72" width="38" height="4" rx="2" fill="#fff3c4"/>`;
    });
    return s + `</svg>`;
  }

  function floorSVG() {
    let s = `<svg class="dsb-layer" style="z-index:2" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`;
    s += `<rect x="0" y="${Y0}" width="752" height="${H - Y0}" fill="url(#dsb-g-floor)"/><rect x="0" y="${Y0}" width="752" height="3" fill="#53688f"/>`;
    [412, 436, 462].forEach(y => { s += `<line x1="0" x2="752" y1="${y}" y2="${y}" stroke="rgba(255,255,255,.05)"/>`; });
    for (let x = -200; x <= 950; x += 70) s += `<line x1="${x}" y1="${Y0}" x2="${x + (x - 420) * 0.45}" y2="${H}" stroke="rgba(255,255,255,.04)"/>`;
    s += `<path d="M20,470 H738" stroke="#f59e0b" stroke-width="3" stroke-dasharray="26 14" opacity=".5"/>`;
    [['PILE ZONE', 40], ['SCAN LANE', 330], ['FORK LANE', 600]].forEach(a => {
      s += `<text x="${a[1]}" y="440" font-size="13" font-weight="800" letter-spacing="4" fill="#f59e0b" opacity=".38" font-family="monospace">${a[0]}</text>`;
    });
    s += `<rect x="560" y="${Y0 + 6}" width="176" height="7" fill="url(#dsb-haz)" opacity=".7"/>`;
    // truck pit
    s += `<rect x="752" y="${Y0}" width="528" height="${H - Y0}" fill="#05080f"/><rect x="752" y="470" width="528" height="10" fill="#1a2438"/><rect x="752" y="${Y0}" width="6" height="${H - Y0}" fill="#2b3a58"/>`;
    s += `<rect x="736" y="${Y0 - 1}" width="20" height="6" fill="url(#dsb-haz)"/>`;
    return s + `</svg>`;
  }

  function wheelSVG(cx, cy, r, cls, id) {
    let sp = '';
    for (let a = 0; a < 360; a += 72) sp += `<line x1="${cx}" y1="${cy}" x2="${(cx + Math.cos(a * Math.PI / 180) * r * 0.58).toFixed(1)}" y2="${(cy + Math.sin(a * Math.PI / 180) * r * 0.58).toFixed(1)}" stroke="#334155" stroke-width="2.4"/>`;
    return `<g${id ? ` id="${id}"` : ''}${cls ? ` class="${cls}"` : ''}><circle cx="${cx}" cy="${cy}" r="${r}" fill="#0b1220"/><circle cx="${cx}" cy="${cy}" r="${(r * 0.62).toFixed(1)}" fill="#64748b"/>${sp}<circle cx="${cx}" cy="${cy}" r="${(r * 0.2).toFixed(1)}" fill="#e2e8f0"/></g>`;
  }

  function truckSVG() {
    let s = `<svg class="dsb-layer" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`;
    // bed + frame
    s += `<rect x="750" y="${Y0}" width="424" height="9" fill="#a16207"/><rect x="750" y="${Y0}" width="424" height="3" fill="#d4a017"/>`;
    for (let x = 770; x < 1170; x += 40) s += `<line x1="${x}" y1="${Y0 + 3}" x2="${x}" y2="${Y0 + 9}" stroke="#7a4a05"/>`;
    s += `<rect x="750" y="${Y0 + 9}" width="520" height="16" fill="#334155" stroke="#1e293b"/><rect x="1000" y="${Y0 + 26}" width="70" height="18" rx="4" fill="#64748b" stroke="#334155"/>`;
    s += `<rect x="744" y="${Y0 + 12}" width="8" height="14" fill="#facc15"/><rect x="744" y="${Y0 + 26}" width="12" height="6" fill="#111827"/>`;
    s += `<rect class="dsb-tail" x="753" y="${Y0 + 13}" width="6" height="11" rx="1"/>`;
    s += `<rect x="738" y="${Y0 - 3}" width="38" height="3" fill="#cbd5e1"/>`;
    // headboard
    s += `<rect x="1170" y="${Y0 - 238}" width="14" height="238" fill="#475569" stroke="#1e293b"/><rect x="1166" y="${Y0 - 246}" width="22" height="8" rx="2" fill="#64748b"/>`;
    for (let k = 0; k < 6; k++) s += `<rect x="1171" y="${Y0 - 230 + k * 38}" width="12" height="5" fill="#94a3b8"/>`;
    // cab
    s += `<path d="M1188,${Y0 + 26} L1188,${Y0 - 118} Q1188,${Y0 - 130} 1200,${Y0 - 130} L1240,${Y0 - 130} Q1252,${Y0 - 130} 1260,${Y0 - 114} L1278,${Y0 - 70} L1278,${Y0 + 26} Z" fill="#e5eaf2" stroke="#94a3b8" stroke-width="1.5"/>`;
    s += `<path d="M1202,${Y0 - 118} L1238,${Y0 - 118} Q1246,${Y0 - 118} 1252,${Y0 - 106} L1266,${Y0 - 76} L1202,${Y0 - 76} Z" fill="#7dd3fc" opacity=".85"/>`;
    s += `<rect x="1188" y="${Y0 - 28}" width="90" height="10" fill="#2563eb"/><rect x="1196" y="${Y0 - 66}" width="26" height="4" rx="2" fill="#94a3b8"/>`;
    s += `<circle cx="1273" cy="${Y0 - 4}" r="5" fill="#fef9c3"/><rect x="1212" y="${Y0 - 140}" width="26" height="10" rx="3" fill="#475569"/><circle class="dsb-tbeacon" cx="1225" cy="${Y0 - 144}" r="5"/>`;
    // wheels + fenders
    [884, 950, 1230].forEach(cx => {
      s += `<path d="M${cx - 34},${Y0 + 24} Q${cx},${Y0 - 2} ${cx + 34},${Y0 + 24}" fill="none" stroke="#475569" stroke-width="5"/>`;
      s += wheelSVG(cx, Y0 + 46, 27, 'dsb-tw');
    });
    return s + `</svg>`;
  }

  function pileSVG() {
    let s = `<svg class="dsb-layer" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`;
    for (let i = 0; i < 5; i++) s += `<rect x="${14 + i * 40}" y="${Y0 - 10}" width="38" height="5" fill="#b98046" stroke="#7a4f22" stroke-width=".8"/>`;
    [18, 100, 190].forEach(x => { s += `<rect x="${x}" y="${Y0 - 5}" width="16" height="5" fill="#8b5a2b"/>`; });
    s += `<rect x="14" y="${Y0 - 2}" width="198" height="2" fill="#6b4220"/>`;
    return s + `</svg>`;
  }

  function conveyorSVG() {
    let s = `<svg class="dsb-layer" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`;
    [316, 420, 524, 628].forEach(x => {
      s += `<rect x="${x}" y="${BELT_Y + 28}" width="10" height="${Y0 - BELT_Y - 28}" fill="#475569"/><rect x="${x - 6}" y="${Y0 - 5}" width="22" height="5" rx="1" fill="#1e293b"/>`;
    });
    s += `<line x1="326" y1="${BELT_Y + 40}" x2="420" y2="${Y0 - 8}" stroke="#334155" stroke-width="3"/><line x1="524" y1="${BELT_Y + 40}" x2="628" y2="${Y0 - 8}" stroke="#334155" stroke-width="3"/>`;
    s += `<rect x="296" y="${BELT_Y + 12}" width="358" height="16" rx="3" fill="#64748b" stroke="#334155"/><rect x="296" y="${BELT_Y + 12}" width="358" height="3" fill="rgba(255,255,255,.25)"/>`;
    for (let x = 308; x < 650; x += 28) s += `<circle cx="${x}" cy="${BELT_Y + 21}" r="2" fill="#334155"/>`;
    s += `<circle cx="298" cy="${BELT_Y + 6}" r="8" fill="#334155" stroke="#1e293b"/><circle cx="654" cy="${BELT_Y + 6}" r="8" fill="#334155" stroke="#1e293b"/>`;
    s += `<rect x="652" y="${BELT_Y - 30}" width="6" height="30" fill="#f59e0b"/><rect x="290" y="${BELT_Y - 16}" width="6" height="16" fill="#f59e0b"/>`;
    s += `<text x="660" y="${BELT_Y - 38}" text-anchor="middle" font-size="10" font-weight="800" letter-spacing="2" fill="#f59e0b" font-family="monospace">PICKUP</text>`;
    // back guard rail
    for (let x = 310; x <= 650; x += 85) s += `<rect x="${x}" y="${BELT_Y - 40}" width="3" height="32" fill="#64748b"/>`;
    s += `<line x1="310" y1="${BELT_Y - 36}" x2="652" y2="${BELT_Y - 36}" stroke="#94a3b8" stroke-width="2.5"/>`;
    return s + `</svg>`;
  }

  function gantryBackSVG() {
    return `<svg class="dsb-layer" style="z-index:7" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">` +
      `<rect x="${GCX + 22}" y="${BELT_Y - 150}" width="9" height="142" fill="#1e293b" stroke="#0b1220"/>` +
      `<polygon points="${GCX - 34},${BELT_Y - 140} ${GCX + 31},${BELT_Y - 152} ${GCX + 31},${BELT_Y - 142} ${GCX - 34},${BELT_Y - 130}" fill="#243049" stroke="#0b1220"/></svg>`;
  }

  function gantryFrontSVG() {
    const g = GCX, b = BELT_Y;
    const pts = `${g - 26},${b + 4} ${g - 26},${b - 124} ${g + 26},${b - 136} ${g + 26},${b - 8}`;
    return `<svg class="dsb-layer" style="z-index:11" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><defs><clipPath id="dsb-clipc"><polygon points="${pts}"/></clipPath></defs>` +
      `<g id="dsb-gantry" class="dsb-gantry"><polygon class="dsb-curt" points="${pts}"/>` +
      `<g clip-path="url(#dsb-clipc)"><g class="dsb-sweepg"><line class="dsb-beam" x1="${g - 28}" y1="${b + 4}" x2="${g + 28}" y2="${b - 8}"/></g></g>` +
      `<rect x="${g - 31}" y="${b - 132}" width="9" height="${Y0 - b + 132}" fill="#26334f" stroke="#0b1220"/>` +
      `<rect x="${g - 42}" y="${b - 146}" width="86" height="18" rx="4" fill="#111a2e" stroke="#3b4d78" stroke-width="1.5"/>` +
      `<rect x="${g - 32}" y="${b - 141}" width="18" height="8" rx="2" fill="#38bdf8"/><rect x="${g + 14}" y="${b - 141}" width="18" height="8" rx="2" fill="#38bdf8"/>` +
      `<circle class="dsb-led" cx="${g}" cy="${b - 137}" r="4"/></g></svg>`;
  }

  function forkliftSVG() {
    return `<svg width="260" height="290" viewBox="-130 -260 260 290" style="position:absolute;left:-130px;top:-260px;overflow:visible">` +
      `<ellipse cx="-62" cy="1" rx="78" ry="5" fill="rgba(0,0,0,.45)"/>` +
      `<rect x="-17" y="-150" width="11" height="150" fill="#3b4a63" stroke="#111a2b"/>` +
      `<rect id="dsb-fk-inner" x="-15" y="-150" width="7" height="124" fill="#64748b" stroke="#1e293b"/>` +
      `<line id="dsb-fk-chain" x1="-11" x2="-11" y1="-146" y2="-120" stroke="#e2e8f0" stroke-dasharray="2 2"/>` +
      `<rect x="-122" y="-72" width="44" height="58" rx="11" fill="#d97706" stroke="#92400e" stroke-width="1.5"/>` +
      `<rect x="-122" y="-62" width="44" height="12" fill="url(#dsb-haz)" opacity=".9"/><rect x="-122" y="-34" width="44" height="7" fill="#111827"/>` +
      `<path d="M-84,-52 L-72,-60 L-30,-60 Q-20,-60 -20,-50 L-20,-14 L-84,-14 Z" fill="#fbbf24" stroke="#b45309" stroke-width="1.5"/>` +
      `<rect x="-70" y="-42" width="30" height="3" fill="#b45309" opacity=".5"/><circle cx="-22" cy="-44" r="3.5" fill="#fef9c3"/>` +
      `<rect x="-86" y="-86" width="8" height="30" rx="3" fill="#374151"/><rect x="-84" y="-60" width="30" height="8" rx="3" fill="#374151"/>` +
      `<line x1="-70" y1="-60" x2="-67" y2="-84" stroke="#f97316" stroke-width="13" stroke-linecap="round"/>` +
      `<circle cx="-63" cy="-96" r="8" fill="#f1c59a"/><path d="M-72,-97 A9,9 0 0 1 -54,-97 L-50,-97 L-50,-94 L-72,-94 Z" fill="#f8fafc" stroke="#94a3b8" stroke-width=".8"/>` +
      `<line x1="-45" y1="-52" x2="-49" y2="-76" stroke="#0f172a" stroke-width="3"/><ellipse cx="-49" cy="-78" rx="3" ry="8" fill="#0f172a"/>` +
      `<polyline points="-66,-82 -57,-70 -49,-76" fill="none" stroke="#33445f" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>` +
      `<line x1="-34" y1="-60" x2="-30" y2="-138" stroke="#0f172a" stroke-width="5" stroke-linecap="round"/><line x1="-100" y1="-72" x2="-98" y2="-138" stroke="#0f172a" stroke-width="5" stroke-linecap="round"/>` +
      `<rect x="-106" y="-146" width="82" height="8" rx="2" fill="#1f2937" stroke="#0b1220"/>` +
      `<rect x="-70" y="-153" width="12" height="7" rx="2" fill="#92400e"/><circle class="dsb-fkbeacon" cx="-64" cy="-157" r="5" fill="#fbbf24"/>` +
      `<path d="M-66,-30 Q-44,-54 -22,-30" fill="none" stroke="#92400e" stroke-width="4"/>` +
      wheelSVG(-44, -20, 20, '', 'dsb-fk-wf') + wheelSVG(-100, -14, 14, '', 'dsb-fk-wr') +
      `<rect id="dsb-fk-back" x="-6" y="-138" width="4" height="56" fill="#334155"/>` +
      `<rect id="dsb-fk-car" x="-6" y="-138" width="8" height="62" rx="1" fill="#475569" stroke="#0f172a"/>` +
      `<rect id="dsb-fk-fork" x="0" y="-82" width="${FORK_LEN}" height="6" rx="1.5" fill="#cbd5e1" stroke="#475569"/>` +
      `</svg>`;
  }

  function workerSVG() {
    return `<svg width="120" height="160" viewBox="-60 -150 120 160" style="position:absolute;left:-60px;top:-150px;overflow:visible">` +
      `<ellipse cx="0" cy="1" rx="22" ry="4" fill="rgba(0,0,0,.4)"/>` +
      `<polyline id="dsb-wk-legB" fill="none" stroke="#131c2e" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>` +
      `<line id="dsb-wk-bootB" stroke="#0a0f1a" stroke-width="7" stroke-linecap="round"/>` +
      `<polyline id="dsb-wk-armB" fill="none" stroke="#243350" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>` +
      `<circle id="dsb-wk-glB" r="4.4" fill="#d99a1f"/>` +
      `<line id="dsb-wk-torso" stroke="#f97316" stroke-width="20" stroke-linecap="round"/>` +
      `<line id="dsb-wk-stripe" stroke="#fde68a" stroke-width="20" stroke-dasharray="2.4 11"/>` +
      `<polyline id="dsb-wk-legF" fill="none" stroke="#1d2b46" stroke-width="9.5" stroke-linecap="round" stroke-linejoin="round"/>` +
      `<line id="dsb-wk-bootF" stroke="#0a0f1a" stroke-width="7.5" stroke-linecap="round"/>` +
      `<circle id="dsb-wk-head" r="9.5" fill="#f1c59a"/><path id="dsb-wk-hat" fill="#fbbf24" stroke="#b45309" stroke-width=".9"/><circle id="dsb-wk-eye" r="1.3" fill="#1f2937"/>` +
      `<polyline id="dsb-wk-armF" fill="none" stroke="#33445f" stroke-width="7.6" stroke-linecap="round" stroke-linejoin="round"/>` +
      `<circle id="dsb-wk-glF" r="4.8" fill="#fbbf24" stroke="#92400e" stroke-width="1"/>` +
      `</svg>`;
  }

  const CHECK = `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#fff"/><path d="M6.5,12.5 l4,4 l7.5,-8.5" fill="none" stroke="#059669" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  function hudSign(id, left, title, chipHtml, extra) {
    return `<div class="dsb-hud" style="left:${left}px"${id ? ` id="${id}"` : ''}><div class="dsb-chain"></div><div class="dsb-sign"><span class="dsb-sign-t">${title}</span>${chipHtml}${extra || ''}</div></div>`;
  }

  function template() {
    return `<div class="dsb-root staging-bay-panel"><div class="dsb-viewport" id="dsb-viewport"><div class="dsb-stage" id="dsb-stage">` +
      bgSVG() + floorSVG() +
      `<div class="dsb-layer dsb-truck" id="dsb-truck" style="z-index:4">${truckSVG()}<div class="dsb-layer" id="dsb-cells"></div>` +
      `<div class="dsb-wrap" id="dsb-wrap"><i class="dsb-strap" style="left:26%"></i><i class="dsb-strap" style="left:70%"></i></div>` +
      `<div class="dsb-ready" id="dsb-ready">${CHECK}<span>LOAD SECURED &bull; READY TO DISPATCH</span></div></div>` +
      `<div class="dsb-layer" id="dsb-pile" style="z-index:5">${pileSVG()}</div>` +
      `<div class="dsb-layer" style="z-index:6">${conveyorSVG()}<div class="dsb-beltt"></div><div class="dsb-beltf"></div></div>` +
      gantryBackSVG() +
      `<div class="dsb-layer" id="dsb-boxes" style="z-index:8"></div>` +
      `<div class="dsb-ent" id="dsb-fk" style="z-index:9">${forkliftSVG()}</div>` +
      `<div class="dsb-ent" id="dsb-wk" style="z-index:10">${workerSVG()}</div>` +
      gantryFrontSVG() +
      `<div class="dsb-layer" id="dsb-hud" style="z-index:20">` +
      hudSign('', 118, 'STAGING PILE', `<span id="transfer-infeed-count" class="dsb-chip dsb-chip-blue">0 PENDING</span>`) +
      hudSign('', GCX, 'SCAN GATE', `<span id="dsb-gate-chip" class="dsb-chip dsb-chip-blue">READY</span>`) +
      hudSign('', 962, 'OUTBOUND TRUCK', `<span id="transfer-dock-count" class="dsb-chip dsb-chip-green">0 LOADED</span>`,
        `<span class="dsb-prog"><i id="dsb-prog-i"></i></span><span class="dsb-progt" id="dsb-prog-t">0/0</span>`) +
      `<div class="dsb-more" id="dsb-more"></div></div>` +
      `</div></div></div>`;
  }

  /* ======================================================================
     MOUNT / FIT
     ====================================================================== */
  function ensureStyles() {
    if (document.getElementById('dispatch-animation-styles')) return;
    const st = document.createElement('style');
    st.id = 'dispatch-animation-styles';
    st.textContent = STYLES;
    document.head.appendChild(st);
  }

  function cacheDom(rootEl) {
    const q = id => rootEl.querySelector('#' + id);
    const d = S.dom = {
      root: rootEl, viewport: q('dsb-viewport'), stage: q('dsb-stage'), truck: q('dsb-truck'), cells: q('dsb-cells'),
      wrap: q('dsb-wrap'), ready: q('dsb-ready'), pileLayer: q('dsb-pile'), boxes: q('dsb-boxes'), hud: q('dsb-hud'),
      fkWrap: q('dsb-fk'), wkWrap: q('dsb-wk'), gantry: q('dsb-gantry'), gateChip: q('dsb-gate-chip'),
      pendingChip: q('transfer-infeed-count'), loadedChip: q('transfer-dock-count'), prog: q('dsb-prog-i'), progTxt: q('dsb-prog-t'), more: q('dsb-more'),
      fk: {}, wk: {}
    };
    ['inner', 'chain', 'car', 'back', 'fork', 'wf', 'wr'].forEach(k => { d.fk[k] = q('dsb-fk-' + k); });
    ['legB', 'bootB', 'armB', 'glB', 'torso', 'stripe', 'legF', 'bootF', 'head', 'hat', 'eye', 'armF', 'glF'].forEach(k => { d.wk[k] = q('dsb-wk-' + k); });
  }

  function fit() {
    const d = S.dom;
    if (!d.viewport || !d.stage) return;
    const w = d.viewport.clientWidth;
    if (!w) return;
    const s = w / W;
    d.stage.style.transform = 'scale(' + s + ')';
    d.stage.style.setProperty('--hk', String(Math.min(2.3, Math.max(1, 0.62 / s)).toFixed(3)));
  }

  function mount(container) {
    ensureStyles();
    const target = typeof container === 'string' ? document.getElementById(container) : container;
    if (!target) return;
    if (!target.querySelector('.dsb-root')) {
      S.epoch++;
      target.innerHTML = template();
      cacheDom(target.querySelector('.dsb-root'));
      S.init = false; S.allocKey = ''; S.truckAway = false; S.arriving = false;
      if (S.ro) { try { S.ro.disconnect(); } catch (e) { /* noop */ } S.ro = null; }
      if (typeof ResizeObserver !== 'undefined') { S.ro = new ResizeObserver(fit); S.ro.observe(S.dom.viewport); }
      else if (typeof window !== 'undefined') window.addEventListener('resize', fit);
      fit();
      clearDynamic();
      S.mounted = true;
    } else if (!S.dom.stage || !target.contains(S.dom.stage)) {
      cacheDom(target.querySelector('.dsb-root'));
      S.mounted = true;
      fit();
    }
  }

  /* ======================================================================
     BOXES
     ====================================================================== */
  function mkBox(info, cls, variant, layer) {
    const el = document.createElement('div');
    el.className = 'dsb-box ' + (cls || '');
    el.innerHTML = boxSVG(info, variant);
    layer.appendChild(el);
    return { el, x: 0, y: 0, sc: 1, tx: 1, info, mvTok: 0, settled: true, targetX: 0 };
  }
  function putBox(b) {
    const sc = b.sc, w = 66 * sc, x = b.x + w * (1 - b.tx) / 2;
    b.el.style.transform = 'translate3d(' + x.toFixed(2) + 'px,' + (b.y - 52 * sc).toFixed(2) + 'px,0) scale(' + (sc * b.tx).toFixed(4) + ',' + sc.toFixed(4) + ')';
  }
  function moveBoxX(b, x, ms) {
    const tok = ++b.mvTok, x0 = b.x;
    b.settled = false; b.targetX = x;
    return tween(ms, e => { if (b.mvTok !== tok) return; b.x = x0 + (x - x0) * e; putBox(b); }, ease.io)
      .then(() => { if (b.mvTok === tok) { b.x = x; putBox(b); b.settled = true; } });
  }

  /* ======================================================================
     PILE
     ====================================================================== */
  function pileSlot(i, v) {
    const cols = Math.ceil(v / 3), col = Math.floor(i / 3), r = i % 3;
    return { x: PILE_R - (cols - col) * PILE_COL_W, y: Y0 - 10 - r * PILE_ROW_H, z: r * 100 + col };
  }
  function layoutPile() {
    const v = S.pile.length;
    S.pile.forEach((b, i) => {
      const p = pileSlot(i, v);
      b.x = p.x; b.y = p.y; b.sc = PILE_SC; b.el.style.zIndex = p.z;
      if (b.fresh) {
        b.el.style.transition = 'none'; putBox(b); void b.el.offsetWidth; b.el.style.transition = ''; b.fresh = false;
      } else putBox(b);
    });
    const remaining = Math.max(0, S.alloc.length - S.picked), extra = remaining - PILE_MAX;
    S.dom.more.textContent = '+' + extra + ' MORE';
    S.dom.more.classList.toggle('on', extra > 0);
  }
  function syncPile() {
    const target = Math.min(PILE_MAX, Math.max(0, S.alloc.length - S.picked));
    while (S.pile.length > target) S.pile.pop().el.remove();
    while (S.pile.length < target) {
      const b = mkBox(null, 'dsb-pbox dsb-fade', S.pile.length, S.dom.pileLayer);
      b.fresh = true; S.pile.push(b);
    }
    layoutPile();
  }

  /* ======================================================================
     TRUCK LAYOUT / CELLS
     ====================================================================== */
  function computeLayout(N) {
    if (N <= 0) return { M: 0, L: 1, cols: 1, sc: 1, k: 1 };
    const M = Math.min(N, MAX_CELLS), Wb = XR - BED_L - 2, Hb = 224;
    let best = null;
    for (let L = 1; L <= 5; L++) {
      const cols = Math.ceil(M / L);
      const sc = Math.min(1, Wb / (56 * cols + 10), Hb / (42 * L + 10));
      const aspect = Math.abs(Math.log((cols * 56) / (L * 42) / 1.8));
      if (!best || sc > best.sc + 0.02 || (Math.abs(sc - best.sc) <= 0.02 && aspect < best.aspect)) best = { L, cols, sc, aspect };
    }
    return { M, L: best.L, cols: best.cols, sc: best.sc, k: Math.ceil(N / M) };
  }
  function cellGeom(ci) {
    const L = S.layout, sc = L.sc, c = Math.floor(ci / L.L), r = ci % L.L;
    return { bx: XR - 10 * sc - (c + 1) * 56 * sc, by: Y0 - r * 42 * sc, hold: r * 42 * sc + 6, z: r * 100 + (L.cols - c), sc };
  }
  function cellIndexFor(i) {
    const L = S.layout, N = Math.max(1, S.alloc.length);
    return Math.max(0, Math.min(L.M - 1, Math.floor(i * L.M / N)));
  }
  function setBadge(cell) {
    if (S.layout.k <= 1 || cell.n < 2) return;
    let sp = cell.b.el.querySelector('.dsb-cnt');
    if (!sp) { sp = document.createElement('span'); sp.className = 'dsb-cnt'; cell.b.el.appendChild(sp); }
    sp.textContent = '\u00d7' + cell.n;
  }
  function addCellStatic(info, i) {
    const ci = cellIndexFor(i), ex = S.cells[ci];
    if (ex) { ex.n++; setBadge(ex); return; }
    const g = cellGeom(ci), b = mkBox(info, 'dsb-cell ok', ci, S.dom.cells);
    b.sc = g.sc; b.x = g.bx; b.y = g.by; b.el.style.zIndex = g.z; putBox(b);
    S.cells[ci] = { b, n: 1 };
  }
  function layoutTruck() {
    const d = S.dom, L = S.layout;
    if (!L || !S.alloc.length) { d.wrap.classList.remove('on'); d.ready.classList.remove('on'); return; }
    const sc = L.sc, left = XR - 10 * sc - L.cols * 56 * sc - 6, top = Y0 - L.L * 42 * sc - 10 * sc - 6;
    d.wrap.style.left = left + 'px'; d.wrap.style.top = top + 'px';
    d.wrap.style.width = (XR + 8 - left) + 'px'; d.wrap.style.height = (Y0 - top + 2) + 'px';
    d.ready.style.left = ((left + XR) / 2) + 'px'; d.ready.style.top = Math.max(96, top - 46) + 'px';
  }
  function evalWrap(force) {
    const d = S.dom;
    if (!d.wrap) return;
    const on = !!force || (S.wantComplete && isIdle() && S.alloc.length > 0 && S.placed >= S.scannedModel.size);
    d.wrap.classList.toggle('on', on);
    d.ready.classList.toggle('on', on);
  }
  function updateHUD() {
    const d = S.dom, N = S.alloc.length, sc = S.scannedModel.size;
    if (!d.pendingChip) return;
    d.pendingChip.textContent = Math.max(0, N - sc) + ' PENDING';
    d.loadedChip.textContent = sc + ' LOADED';
    d.prog.style.width = (N ? Math.round(S.placed / N * 100) : 0) + '%';
    d.progTxt.textContent = S.placed + '/' + N;
  }
  function onProgress() { updateHUD(); evalWrap(); }

  /* ======================================================================
     WORKER
     ====================================================================== */
  const SY0 = -54 - 40 * Math.cos(0.12);
  function crouchFor(handY) { return Math.max(0, Math.min(44, (handY - (SY0 + 30)) / 0.8)); }

  function applyWorker() {
    const w = S.WK, d = S.dom.wk, f = w.f, fs = Math.abs(f) < 0.04 ? (f < 0 ? -0.04 : 0.04) : f, k = w.crouch;
    S.dom.wkWrap.style.transform = 'translate3d(' + w.x.toFixed(2) + 'px,' + Y0 + 'px,0) scaleX(' + fs.toFixed(3) + ')';
    const lean = 0.12 + k * 0.0165;
    const hip = { x: -1, y: -54 + k * 0.5 };
    const sh = { x: hip.x + Math.sin(lean) * 40, y: hip.y - Math.cos(lean) * 40 };
    const head = { x: sh.x + Math.sin(lean + 0.1) * 12 + 2, y: sh.y - Math.cos(lean + 0.1) * 12 - 5 };
    const a1 = w.phase, a2 = w.phase + Math.PI, amp = w.amp;
    const f1 = { x: 7 + k * 0.12 + amp * 15 * Math.sin(a1), y: -amp * 8 * Math.max(0, Math.cos(a1)) };
    const f2 = { x: -7 - k * 0.1 + amp * 15 * Math.sin(a2), y: -amp * 8 * Math.max(0, Math.cos(a2)) };
    const l1 = ik(hip.x, hip.y, f1.x, f1.y, 28, 28, -1), l2 = ik(hip.x, hip.y, f2.x, f2.y, 28, 28, -1);
    d.legF.setAttribute('points', hip.x + ',' + hip.y + ' ' + l1.ex.toFixed(1) + ',' + l1.ey.toFixed(1) + ' ' + l1.hx.toFixed(1) + ',' + l1.hy.toFixed(1));
    d.legB.setAttribute('points', hip.x + ',' + hip.y + ' ' + l2.ex.toFixed(1) + ',' + l2.ey.toFixed(1) + ' ' + l2.hx.toFixed(1) + ',' + l2.hy.toFixed(1));
    [[d.bootF, l1], [d.bootB, l2]].forEach(p => {
      p[0].setAttribute('x1', (p[1].hx - 3).toFixed(1)); p[0].setAttribute('y1', (p[1].hy - 3).toFixed(1));
      p[0].setAttribute('x2', (p[1].hx + 8).toFixed(1)); p[0].setAttribute('y2', (p[1].hy - 3).toFixed(1));
    });
    [['torso', 'stripe']].forEach(ks => ks.forEach(key => {
      d[key].setAttribute('x1', hip.x); d[key].setAttribute('y1', hip.y);
      d[key].setAttribute('x2', sh.x.toFixed(1)); d[key].setAttribute('y2', sh.y.toFixed(1));
    }));
    d.head.setAttribute('cx', head.x.toFixed(1)); d.head.setAttribute('cy', head.y.toFixed(1));
    d.hat.setAttribute('d', 'M' + (head.x - 11) + ',' + (head.y - 1) + ' L' + (head.x - 11) + ',' + (head.y - 4) + ' A11,11 0 0 1 ' + (head.x + 11) + ',' + (head.y - 4) + ' L' + (head.x + 17) + ',' + (head.y - 4) + ' L' + (head.x + 17) + ',' + (head.y - 1) + ' Z');
    d.eye.setAttribute('cx', (head.x + 5).toFixed(1)); d.eye.setAttribute('cy', (head.y + 0.5).toFixed(1));
    const t1 = { x: w.hx - 3, y: w.hy + 17 }, t2 = { x: w.hx + 3, y: w.hy + 13 };
    const r1 = ik(sh.x, sh.y, t1.x, t1.y, 29, 29, 1), r2 = ik(sh.x, sh.y, t2.x, t2.y, 29, 29, 1);
    d.armF.setAttribute('points', sh.x.toFixed(1) + ',' + sh.y.toFixed(1) + ' ' + r1.ex.toFixed(1) + ',' + r1.ey.toFixed(1) + ' ' + r1.hx.toFixed(1) + ',' + r1.hy.toFixed(1));
    d.armB.setAttribute('points', sh.x.toFixed(1) + ',' + sh.y.toFixed(1) + ' ' + r2.ex.toFixed(1) + ',' + r2.ey.toFixed(1) + ' ' + r2.hx.toFixed(1) + ',' + r2.hy.toFixed(1));
    d.glF.setAttribute('cx', r1.hx.toFixed(1)); d.glF.setAttribute('cy', r1.hy.toFixed(1));
    d.glB.setAttribute('cx', r2.hx.toFixed(1)); d.glB.setAttribute('cy', r2.hy.toFixed(1));
    const b = w.held;
    if (b) {
      const sc = w.hsc, cx = w.x + f * w.hx, cy = Y0 + w.hy;
      b.sc = sc; b.tx = 1; b.x = cx - 28 * sc; b.y = cy + 21 * sc; putBox(b);
    }
  }

  async function walk(x) {
    const w = S.WK, x0 = w.x, dist = Math.abs(x - x0);
    if (dist < 1) return;
    w.amp = 1;
    let last = x0;
    try {
      await tween(140 + dist * 9, e => {
        w.x = x0 + (x - x0) * e;
        w.phase += (w.x - last) * (w.f < 0 ? -1 : 1) * 0.21;
        last = w.x; applyWorker();
      }, ease.io);
    } finally { w.amp = 0; applyWorker(); }
  }

  async function workerJob(info) {
    const WK = S.WK, ap = applyWorker;
    await waitUntil(() => !S.startOcc && S.convCount < MAX_ON_BELT);
    // face the pile, walk over
    await Promise.all([to(WK, { f: -1, hx: 12, hy: -48 }, 240, ease.io, ap), walk(PICK_X)]);
    // reach for the top box of the right-most stack
    const pb = S.pile[S.pile.length - 1];
    const cx = pb ? pb.x + 28 * PILE_SC : PICK_X - 26, cy = pb ? pb.y - 21 * PILE_SC : Y0 - 60;
    const hx = WK.x - cx, hy = cy - Y0;
    await to(WK, { hx, hy, crouch: crouchFor(hy + 17) }, 420, ease.out, ap);
    // grab: pile box becomes the (labelled) box in the worker's hands
    const b = mkBox(info, '', 0, S.dom.boxes);
    b.sc = PILE_SC;
    S.picked++;
    if (pb) { S.pile.pop(); pb.el.remove(); }
    syncPile();
    WK.held = b; WK.hsc = PILE_SC; ap();
    await to(WK, { hx: 34, hy: -82, crouch: 0, hsc: 1 }, 380, ease.io, ap);
    // turn and carry to the belt
    await Promise.all([to(WK, { f: 1 }, 260, ease.io, ap), walk(PLACE_X)]);
    await to(WK, { hx: START_X + 28 - PLACE_X, hy: BELT_Y - 21 - Y0 }, 260, ease.out, ap);
    // place on belt
    WK.held = null; b.sc = 1; b.tx = 1; b.x = START_X; b.y = BELT_Y; putBox(b);
    S.startOcc = true; S.convCount++;
    runSafe(() => beltFlow(b));
    await to(WK, { hx: 12, hy: -48 }, 240, ease.io, ap);
  }

  async function workerLoop() {
    if (S.workerBusy) return;
    S.workerBusy = true;
    const E = S.epoch;
    try {
      while (S.jobs.length) {
        bumpSpeed();
        await workerJob(S.jobs.shift());
      }
    } catch (e) { if (e !== ABORT) console.error(e); }
    finally { if (E === S.epoch) { S.workerBusy = false; onProgress(); } }
  }

  /* ======================================================================
     BELT + SCANNER
     ====================================================================== */
  function toast(info) {
    const t = document.createElement('div');
    t.className = 'dsb-toast';
    t.textContent = '\u2713 #' + info.batch + ' \u00b7 ' + info.qty + 'P VERIFIED';
    S.dom.hud.appendChild(t);
    setTimeout(() => t.remove(), 1500);
  }

  async function scanAt(b) {
    const g = S.dom.gantry, chip = S.dom.gateChip;
    g.classList.add('scanning');
    chip.textContent = 'SCANNING\u2026'; chip.className = 'dsb-chip dsb-chip-amber';
    await sleep(560);
    g.classList.remove('scanning'); g.classList.add('hit'); b.el.classList.add('ok');
    chip.textContent = '\u2713 VERIFIED'; chip.className = 'dsb-chip dsb-chip-green';
    toast(b.info);
    await sleep(420);
    g.classList.remove('hit');
    chip.textContent = 'READY'; chip.className = 'dsb-chip dsb-chip-blue';
  }

  async function beltFlow(b) {
    try {
      await waitUntil(() => !S.gateOcc);
      S.gateOcc = true;
      await moveBoxX(b, GATE_X, 480);
      S.startOcc = false;
      await scanAt(b);
      S.convQueue.push(b);
      const i = S.convQueue.length - 1;
      S.gateOcc = false;
      await moveBoxX(b, SLOT_X[i], 260 + Math.abs(SLOT_X[i] - b.x) * 2.4);
      runSafe(forkLoop);
    } catch (e) { if (e !== ABORT) console.error(e); }
  }

  function requeue() {
    S.convQueue.forEach((b, i) => {
      if (b.targetX !== SLOT_X[i] || b.x !== SLOT_X[i]) moveBoxX(b, SLOT_X[i], 380).catch(noop);
    });
  }

  /* ======================================================================
     FORKLIFT
     ====================================================================== */
  function applyFork() {
    const F = S.FK, d = S.dom.fk, f = F.f, fs = Math.abs(f) < 0.03 ? (f < 0 ? -0.03 : 0.03) : f, lift = F.lift;
    S.dom.fkWrap.style.transform = 'translate3d(' + F.x.toFixed(2) + 'px,' + Y0 + 'px,0) scaleX(' + fs.toFixed(3) + ')';
    d.car.setAttribute('y', -(lift + 56)); d.back.setAttribute('y', -(lift + 56)); d.fork.setAttribute('y', -lift);
    const top = Math.max(150, lift + 66);
    d.inner.setAttribute('y', -top); d.inner.setAttribute('height', top - 26);
    d.chain.setAttribute('y1', -top + 4); d.chain.setAttribute('y2', -(lift + 56));
    const dx = F.x - F.lastX; F.lastX = F.x; F.odo += dx;
    const sgn = fs < 0 ? -1 : 1;
    d.wf.setAttribute('transform', 'rotate(' + (F.odo / 20 * 57.2958 * sgn).toFixed(1) + ' -44 -20)');
    d.wr.setAttribute('transform', 'rotate(' + (F.odo / 14 * 57.2958 * sgn).toFixed(1) + ' -100 -14)');
    const b = F.held;
    if (b) {
      const sc = b.sc, cx = F.x + f * (4 + 28 * sc);
      b.x = cx - 28 * sc; b.y = Y0 - lift; b.tx = Math.max(0.08, Math.abs(f)); putBox(b);
    }
  }

  function commitBox(b, ci, g) {
    const ex = S.cells[ci];
    if (ex) {
      ex.n++; setBadge(ex);
      b.el.style.transition = 'opacity .3s'; b.el.style.opacity = '0';
      setTimeout(() => b.el.remove(), 350);
      return;
    }
    b.el.classList.add('dsb-cell');
    b.el.style.zIndex = g.z;
    S.dom.cells.appendChild(b.el);
    S.cells[ci] = { b, n: 1 };
    requestAnimationFrame(() => {
      b.el.style.transition = 'transform .14s ease-in'; b.y = g.by; putBox(b);
      setTimeout(() => { b.el.style.transition = ''; }, 220);
    });
  }

  async function forkCycle(b) {
    const FK = S.FK, ap = applyFork;
    bumpSpeed();
    await waitUntil(() => !S.truckAway && !S.arriving);
    // engage the box on the belt
    await to(FK, { x: ENGAGE_X, lift: 82 }, 520, ease.io, ap);
    await to(FK, { lift: 88 }, 170, ease.io, ap);
    FK.held = b; b.sc = 1; b.tx = 1; ap();
    S.convQueue.shift(); S.convCount--; requeue();
    await to(FK, { lift: 104 }, 260, ease.out, ap);
    // back away, then U-turn toward the truck
    await to(FK, { x: TURN_X, lift: 18 }, 750, ease.io, ap);
    await to(FK, { f: 1 }, 520, ease.io, ap);
    // drive in and raise to the target slot
    const ci = cellIndexFor(S.placed), g = cellGeom(ci), tx = g.bx - 4;
    const ms = 380 + Math.abs(tx - TURN_X) * 1.7;
    await Promise.all([to(FK, { x: tx }, ms, ease.io, ap), to(FK, { lift: g.hold }, ms, ease.io, ap), to(b, { sc: g.sc }, ms, ease.io, ap)]);
    // release
    FK.held = null; b.sc = g.sc; b.tx = 1; b.x = g.bx; b.y = g.by - 6; putBox(b);
    S.placed++;
    commitBox(b, ci, g);
    onProgress();
    await to(FK, { lift: Math.max(6, g.hold - 8) }, 200, ease.out, ap);
    // reverse out, turn back to face the belt, return to park
    const back = 360 + Math.abs(FK.x - TURN_X) * 1.7;
    await Promise.all([to(FK, { x: TURN_X }, back, ease.io, ap), to(FK, { lift: 82 }, back, ease.io, ap)]);
    await to(FK, { f: -1 }, 480, ease.io, ap);
    await to(FK, { x: PARK_X }, 420, ease.io, ap);
  }

  async function forkLoop() {
    if (S.forkBusy) return;
    S.forkBusy = true;
    const E = S.epoch;
    try {
      for (;;) {
        await waitUntil(() => { const h = S.convQueue[0]; return !h || h.settled; });
        const head = S.convQueue[0];
        if (!head) break;
        await forkCycle(head);
      }
    } catch (e) { if (e !== ABORT) console.error(e); }
    finally { if (E === S.epoch) { S.forkBusy = false; onProgress(); } }
  }

  /* ======================================================================
     JOBS / SYNC
     ====================================================================== */
  function instantLoad(info) {
    S.picked++; syncPile();
    addCellStatic(info, S.placed); S.placed++;
  }
  function enqueue(info) {
    S.jobs.push(info);
    while (S.jobs.length > MAX_BACKLOG) instantLoad(S.jobs.shift());
    runSafe(workerLoop);
  }

  function resetActors() {
    Object.assign(S.WK, { x: PLACE_X, f: 1, crouch: 0, hx: 12, hy: -48, phase: 0, amp: 0, held: null, hsc: 1 });
    Object.assign(S.FK, { x: PARK_X, f: -1, lift: 82, odo: 0, lastX: PARK_X, held: null });
    if (S.dom.wk && S.dom.wk.legF) { applyWorker(); applyFork(); }
  }

  function clearDynamic() {
    S.epoch++;
    const d = S.dom;
    if (!d.boxes) return;
    d.boxes.innerHTML = ''; d.cells.innerHTML = '';
    S.pile.forEach(b => b.el.remove());
    S.pile = []; S.cells = []; S.jobs = []; S.convQueue = []; S.convCount = 0;
    S.workerBusy = false; S.forkBusy = false; S.startOcc = false; S.gateOcc = false; S.speed = 1;
    d.gantry.classList.remove('scanning', 'hit', 'ping');
    d.gateChip.textContent = 'READY'; d.gateChip.className = 'dsb-chip dsb-chip-blue';
    d.hud.querySelectorAll('.dsb-toast,.dsb-ring').forEach(n => n.remove());
    d.wrap.classList.remove('on'); d.ready.classList.remove('on');
    resetActors();
  }

  function arriveTruck() {
    const T = S.dom.truck;
    S.truckAway = false; S.arriving = true;
    T.style.transition = 'none'; T.style.transform = 'translate3d(900px,0,0)';
    void T.offsetWidth;
    T.classList.add('reversing');
    T.style.transition = 'transform 2.3s cubic-bezier(.25,.6,.35,1)'; T.style.transform = 'translate3d(0,0,0)';
    setTimeout(() => { S.arriving = false; T.classList.remove('reversing'); T.style.transition = ''; T.style.transform = ''; }, 2400);
  }

  function syncStatic(alloc, scannedIds) {
    clearDynamic();
    S.alloc = alloc.map(b => ({ id: String(b.boxId), batch: b.batchNumber, qty: b.completedCount }));
    S.allocMap = new Map(S.alloc.map(a => [a.id, a]));
    S.allocKey = alloc.map(b => b.boxId).join('|');
    S.layout = computeLayout(S.alloc.length);
    const loaded = [];
    scannedIds.forEach(id => { if (S.allocMap.has(id) && loaded.indexOf(id) < 0) loaded.push(id); });
    S.scannedModel = new Set(loaded);
    loaded.forEach((id, i) => addCellStatic(S.allocMap.get(id), i));
    S.placed = loaded.length; S.picked = loaded.length;
    syncPile(); layoutTruck(); updateHUD(); evalWrap();
    if (S.truckAway) arriveTruck();
  }

  /* ======================================================================
     PUBLIC API
     ====================================================================== */
  function render(options) {
    options = options || {};
    const container = document.getElementById('dispatch-animation-container');
    if (container && !container.querySelector('.dsb-root')) mount(container);
    if (!S.mounted || !S.dom.stage) return;
    if (S.departing) { S.pendingRender = options; return; }

    const alloc = options.allocatedBoxes || [], scanned = options.scannedBoxes || [];
    const ids = scanned.map(s => String(s && s.boxId != null ? s.boxId : s));
    const allocSet = new Set(alloc.map(b => String(b.boxId)));
    const valid = [], vset = new Set();
    ids.forEach(id => { if (allocSet.has(id) && !vset.has(id)) { vset.add(id); valid.push(id); } });
    S.wantComplete = !!options.isComplete || (alloc.length > 0 && valid.length === alloc.length);

    const key = alloc.map(b => b.boxId).join('|');
    let regress = false;
    S.scannedModel.forEach(id => { if (!vset.has(id)) regress = true; });

    if (!S.init || key !== S.allocKey || regress || (typeof document !== 'undefined' && document.hidden)) {
      syncStatic(alloc, valid);
      S.init = true;
      return;
    }
    valid.forEach(id => {
      if (!S.scannedModel.has(id)) { S.scannedModel.add(id); enqueue(S.allocMap.get(id)); }
    });
    updateHUD(); evalWrap();
  }

  function triggerScanEffect() {
    if (!S.mounted || !S.dom.gantry) return;
    const g = S.dom.gantry;
    g.classList.add('ping');
    clearTimeout(S.pingT);
    S.pingT = setTimeout(() => g.classList.remove('ping'), 650);
    const r = document.createElement('div');
    r.className = 'dsb-ring';
    S.dom.hud.appendChild(r);
    setTimeout(() => r.remove(), 900);
  }

  function runDeparture(resolve) {
    const T = S.dom.truck;
    (async () => {
      const t0 = Date.now();
      while (!isIdle() && Date.now() - t0 < 7000) await wait(100);
      evalWrap(true);
      await wait(700);
      T.classList.add('revving');
      await wait(500);
      T.classList.remove('revving'); T.classList.add('driving');
      T.style.transition = 'transform 2.6s cubic-bezier(.55,.05,.85,.45)';
      T.style.transform = 'translate3d(920px,0,0)';
      setTimeout(resolve, 1500);
      await wait(2700);
    })().catch(noop).then(() => {
      T.classList.remove('driving', 'revving');
      T.style.transition = 'none';
      S.truckAway = true; S.departing = false; S.depP = null;
      resolve();
      const pr = S.pendingRender, rs = S.pendingReset;
      S.pendingRender = null; S.pendingReset = false;
      if (rs || pr) { doReset(); if (pr) render(pr); }
    });
  }

  function triggerDeparture() {
    if (!S.mounted || !S.dom.truck) return Promise.resolve();
    if (S.departing) return S.depP;
    S.departing = true;
    S.depP = new Promise(resolve => runDeparture(resolve));
    return S.depP;
  }

  function doReset() {
    S.init = false;
    syncStatic([], []);
  }

  function reset() {
    if (!S.mounted || !S.dom.stage) return;
    if (S.departing) { S.pendingReset = true; S.pendingRender = null; return; }
    doReset();
  }

  /* auto-init */
  if (typeof document !== 'undefined') {
    const boot = () => { const c = document.getElementById('dispatch-animation-container'); if (c) mount(c); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }

  return { mount, render, triggerScanEffect, triggerDeparture, reset };
});