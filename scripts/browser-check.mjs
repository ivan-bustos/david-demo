// Real-browser checks + screenshots via geckodriver (W3C WebDriver), no npm deps.
// Requires geckodriver + Firefox on PATH and the preview server running:
//   npm run preview            # serves on http://127.0.0.1:4173/
//   npm run browser-check      # SHOT_DIR=... URL=... optional
//
// Headless Firefox cannot make a window narrower than ~500 CSS px, so 320/390/768 px layouts
// are rendered in a same-origin <iframe> of exactly that size (a real viewport for media
// queries/layout). Keyboard behaviour is tested in real windows (narrowest achievable + 1440).
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const URL = process.env.URL || "http://127.0.0.1:4173/";
const SHOT_DIR = resolve(process.env.SHOT_DIR || join(root, "screenshots"));
const PORT = 4444 + Math.floor(Math.random() * 500);
const WD = `http://127.0.0.1:${PORT}`;
mkdirSync(SHOT_DIR, { recursive: true });

let failures = 0, passes = 0;
const check = (ok, label) => { ok ? passes++ : failures++; console.log(`  ${ok ? "ok  " : "FAIL"} ${label}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const artifacts = [];

const driver = spawn("geckodriver", ["--port", String(PORT)], { stdio: "ignore" });
const cleanup = () => { try { driver.kill(); } catch {} };
process.on("exit", cleanup);

async function wd(method, path, body) {
  const res = await fetch(WD + path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json();
  if (json.value && json.value.error) throw new Error(`${path}: ${json.value.error} ${json.value.message}`);
  return json.value;
}
async function waitForDriver() {
  for (let i = 0; i < 100; i++) { try { await fetch(WD + "/status"); return; } catch { await sleep(200); } }
  throw new Error("geckodriver did not start");
}
const pngSize = (buf) => ({ w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) });
function savePng(b64, file, expect, note) {
  const buf = Buffer.from(b64, "base64");
  const path = join(SHOT_DIR, file);
  writeFileSync(path, buf);
  const { w, h } = pngSize(buf);
  check(w === expect.w && h === expect.h, `${file}: PNG ${w}x${h} equals expected ${expect.w}x${expect.h}`);
  artifacts.push({ file: path, pngWidth: w, pngHeight: h, note });
}
const key = (k) => ({ type: "key", id: "kb", actions: [{ type: "keyDown", value: k }, { type: "keyUp", value: k }] });

async function newSession(prefs = {}) {
  const v = await wd("POST", "/session", { capabilities: { alwaysMatch: { browserName: "firefox", "moz:firefoxOptions": { args: ["-headless"], prefs } } } });
  const id = v.sessionId;
  const s = {
    id,
    exec: (script, args = []) => wd("POST", `/session/${id}/execute/sync`, { script, args }),
    go: (u) => wd("POST", `/session/${id}/url`, { url: u }),
    rect: (width, height) => wd("POST", `/session/${id}/window/rect`, { width, height }),
    tab: () => wd("POST", `/session/${id}/actions`, { actions: [key("")] }),
    enter: () => wd("POST", `/session/${id}/actions`, { actions: [key("")] }),
    quit: () => wd("DELETE", `/session/${id}`),
  };
  s.viewport = async (w, h) => {
    await s.rect(w, h);
    for (let i = 0; i < 3; i++) {
      const m = await s.exec("return {w: innerWidth, h: innerHeight};");
      if (m.w === w && m.h === h) break;
      const r = await wd("GET", `/session/${id}/window/rect`);
      await s.rect(r.width + (w - m.w), r.height + (h - m.h));
    }
    return s.exec("return {w: innerWidth, h: innerHeight, dpr: devicePixelRatio};");
  };
  return s;
}

// Pause animations at a fixed frame for deterministic captures; hide classic scrollbar.
const CAPTURE_CSS = "html{scrollbar-width:none!important}*{animation-play-state:paused!important;animation-delay:-1.5s!important}";
const FOCUSABLE = 'a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])';

// Rendered target size of every focusable control, measured with getBoundingClientRect in the
// live layout (not CSS declarations). Goal: >= 44x44 CSS px (WCAG 2.5.5 AAA size; exceeds 2.5.8 AA 24x24).
const TARGETS_JS = `const d=arguments[0]||document; return [...d.querySelectorAll(arguments[1])].map(e=>{const r=e.getBoundingClientRect();
  return {label:(e.getAttribute('aria-label')||e.textContent).trim().replace(/\\s+/g,' ').replace(/[→↑]/g,'').trim(), w:Math.round(r.width*10)/10, h:Math.round(r.height*10)/10};});`;
function checkTargets(list, where) {
  const small = list.filter((t) => t.w < 44 || t.h < 44);
  const min = list.reduce((m, t) => ({ w: Math.min(m.w, t.w), h: Math.min(m.h, t.h) }), { w: Infinity, h: Infinity });
  check(list.length === 10 && !small.length, `${where}: all ${list.length} controls render >= 44x44 CSS px (smallest width ${min.w}, smallest height ${min.h})${small.length ? ": " + small.map((t) => `"${t.label}" ${t.w}x${t.h}`).join("; ") : ""}`);
}

await waitForDriver();
console.log(`URL: ${URL}\nSHOT_DIR: ${SHOT_DIR}`);

const s = await newSession({ "ui.prefersReducedMotion": 0 });
try {
  console.log("Narrow layouts (same-origin iframe of exact size)");
  for (const [w, h, name] of [[320, 640, "mobile-320x640"], [390, 844, "mobile-390x844"], [768, 1024, "tablet-768x1024"]]) {
    await s.rect(1200, Math.max(h + 200, 1000));
    await s.go(URL);
    await s.exec(`document.open(); document.write('<!doctype html><body style="margin:0;background:#888"><iframe id="f" style="border:0;display:block" width="' + arguments[0] + '" height="' + arguments[1] + '" src="' + location.href + '"></iframe></body>'); document.close();`, [w, h]);
    await sleep(1200);
    const m = await s.exec(`const d=document.getElementById('f').contentDocument, v=d.defaultView;
      const can=d.querySelector('.can').getBoundingClientRect(), h1=d.querySelector('h1').getBoundingClientRect(), cta=d.querySelector('.hero .btn--primary').getBoundingClientRect();
      return {iw:v.innerWidth, ih:v.innerHeight, sw:d.documentElement.scrollWidth, cw:d.documentElement.clientWidth,
        mqTab:v.matchMedia('(min-width: 40rem)').matches, mqDesk:v.matchMedia('(min-width: 60rem)').matches, dpr:v.devicePixelRatio,
        h1Bottom:h1.bottom, ctaTop:cta.top, ctaBottom:cta.bottom, ctaBox:{x:cta.x, y:cta.y, width:cta.width, height:cta.height, right:cta.right, bottom:cta.bottom}, canTop:can.top, canH:can.height, headerBottom:d.querySelector('.site-header').getBoundingClientRect().bottom,
        restTop:(()=>{const c=d.querySelector('.can'); c.style.animation='none'; c.style.transform='none'; const t=c.getBoundingClientRect().top; c.style.animation=''; c.style.transform=''; return t;})()};`);
    check(m.iw === w && m.ih === h, `iframe CSS viewport ${m.iw}x${m.ih} (requested ${w}x${h})`);
    checkTargets(await s.exec(TARGETS_JS.replace("arguments[0]||document", "document.getElementById('f').contentDocument"), [null, FOCUSABLE]), `target size at ${w}px`);
    check(m.sw <= m.cw, `no horizontal overflow at ${m.iw}px (scrollWidth ${m.sw} <= clientWidth ${m.cw})`);
    check(w < 640 ? !m.mqTab : (w < 960 ? m.mqTab && !m.mqDesk : m.mqDesk), `expected breakpoint active at ${m.iw}px`);
    check(m.canTop >= 0 && m.canTop + m.canH <= h, `whole can visible in first screen (top ${Math.round(m.canTop)}px, height ${Math.round(m.canH)}px)`);
    check(m.restTop >= m.headerBottom, `can layout box (at rest, no float/tilt) starts below the header (top ${Math.round(m.restTop)}px >= header bottom ${Math.round(m.headerBottom)}px; animated bbox top ${Math.round(m.canTop)}px)`);
    check(m.h1Bottom <= h, `h1 visible in first screen (bottom ${Math.round(m.h1Bottom)}px)`);
    check(m.ctaTop >= 0 && m.ctaBottom <= h, `whole primary CTA inside first screen (top ${Math.round(m.ctaTop)}px, bottom ${Math.round(m.ctaBottom)}px <= ${h})`);
    console.log(`    CTA box at ${w}x${h}: ${JSON.stringify(m.ctaBox)}`);
    const sh = await s.exec(`const d=document.getElementById('f').contentDocument; const st=d.createElement('style');
      st.textContent=arguments[0]; d.head.appendChild(st); return d.documentElement.scrollHeight;`, [CAPTURE_CSS]);
    await sleep(200);
    const el = await wd("POST", `/session/${s.id}/element`, { using: "css selector", value: "#f" });
    const eid = Object.values(el)[0];
    savePng(await wd("GET", `/session/${s.id}/element/${eid}/screenshot`), `${name}-viewport.png`, { w, h }, `${w}x${h} CSS viewport in iframe, first screen`);
    if (w === 390) {
      // Full-page coverage at the true 390x844 viewport: scroll the iframe one screen at a time.
      const vh = h - 44; // overlap a little so nothing falls between frames
      for (let y = 0, n = 1; y < sh; y += vh, n++) {
        const at = await s.exec(`const v=document.getElementById('f').contentWindow; v.document.documentElement.style.scrollBehavior='auto'; v.scrollTo(0, arguments[0]); return v.scrollY;`, [y]);
        await sleep(250);
        savePng(await wd("GET", `/session/${s.id}/element/${eid}/screenshot`), `mobile-390x844-scroll-${n}.png`, { w, h }, `${w}x${h} iframe viewport scrolled to y=${at} of ${sh}`);
        if (at + h >= sh) break;
      }
    }
  }

  console.log("Desktop layout (real window)");
  const dv = await s.viewport(1440, 900);
  check(dv.w === 1440 && dv.h === 900 && dv.dpr === 1, `window CSS viewport ${dv.w}x${dv.h} @${dv.dpr}x`);
  await s.go(URL); await sleep(500);
  const d = await s.exec(`const cta=document.querySelector('.hero .btn--primary').getBoundingClientRect(), can=document.querySelector('.can').getBoundingClientRect();
    return {sw:document.documentElement.scrollWidth, cw:document.documentElement.clientWidth, ctaBottom:cta.bottom, ctaBox:{x:cta.x, y:cta.y, width:cta.width, height:cta.height, right:cta.right, bottom:cta.bottom}, canBottom:can.bottom, canLeft:can.left};`);
  checkTargets(await s.exec(TARGETS_JS, [null, FOCUSABLE]), "target size at 1440px");
  check(d.sw <= d.cw, `no horizontal overflow at 1440px (scrollWidth ${d.sw} <= clientWidth ${d.cw})`);
  console.log(`    CTA box at 1440x900: ${JSON.stringify(d.ctaBox)}`);
  check(d.ctaBottom <= 900 && d.canBottom <= 900 && d.canLeft > 700, `desktop first screen shows CTA and whole can side by side (can bottom ${Math.round(d.canBottom)}px, left ${Math.round(d.canLeft)}px)`);
  const st = await s.exec(`const st=document.createElement('style'); st.textContent=arguments[0]; document.head.appendChild(st);
    return {cw:document.documentElement.clientWidth, sh:document.documentElement.scrollHeight, iw:innerWidth, ih:innerHeight};`, [CAPTURE_CSS]);
  await sleep(200);
  savePng(await wd("GET", `/session/${s.id}/screenshot`), "desktop-1440x900-viewport.png", { w: st.iw, h: st.ih }, "1440x900 real window, first screen");
  savePng(await wd("GET", `/session/${s.id}/moz/screenshot/full`), "desktop-1440-full.png", { w: st.cw, h: st.sh }, "1440px real window, full page");

  for (const [reqW, reqH] of [[390, 844], [1440, 900]]) {
    const vp = await s.viewport(reqW, reqH);
    console.log(`Keyboard: full Tab sequence, real window ${vp.w}x${vp.h}${vp.w !== reqW ? ` (requested ${reqW}; headless minimum width)` : ""}`);
    await s.go(URL + "?k=" + Date.now()); await sleep(300);
    const expected = await s.exec(`const els=[...document.querySelectorAll(arguments[0])]; els.forEach((e,i)=>e.dataset.kb=i);
      return els.map(e=>(e.getAttribute('aria-label')||e.textContent||'').trim().replace(/\\s+/g,' ').replace(/[→↑]/g,'').trim());`, [FOCUSABLE]);
    const seen = [], outlineProblems = [], visProblems = [];
    for (let i = 0; i < expected.length + 1; i++) {
      await s.tab(); await sleep(80);
      const o = await s.exec(`const a=document.activeElement; if(!a||a===document.body||a===document.documentElement) return null;
        const cs=getComputedStyle(a), r=a.getBoundingClientRect(), hit=document.elementFromPoint(r.left+r.width/2, r.top+r.height/2);
        return {kb:a.dataset.kb, outline:cs.outlineStyle+' '+cs.outlineWidth, color:cs.outlineColor,
          inView:r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth, unobscured:!!hit&&(a===hit||a.contains(hit))};`);
      if (o === null) break;
      seen.push(o.kb === undefined ? "?" : +o.kb);
      if (!/solid 3px/.test(o.outline)) outlineProblems.push(`#${o.kb} ${o.outline}`);
      if (!o.inView || !o.unobscured) visProblems.push(`#${o.kb} "${expected[o.kb]}" inView=${o.inView} unobscured=${o.unobscured}`);
    }
    const want = expected.map((_, i) => i);
    console.log(`    sequence: ${seen.map((i) => expected[i] ?? "?").join(" -> ")}`);
    check(JSON.stringify(seen.slice(0, want.length)) === JSON.stringify(want), `Tab visits all ${want.length} focusable elements in DOM order`);
    check(expected[0] === "Skip to main content", "first Tab stop is the skip link");
    await s.go(URL + "?k=" + Date.now()); await sleep(300); await s.tab(); await sleep(100);
    const sk = await s.exec(`const a=document.activeElement, r=a.getBoundingClientRect(), cs=getComputedStyle(a);
      return {cls:a.className, top:r.top, w:r.width, h:r.height, shadow:cs.boxShadow, outline:cs.outlineStyle+' '+cs.outlineWidth+' '+cs.outlineColor};`);
    check(sk.cls === "skip-link" && sk.top >= 0 && sk.w >= 44 && sk.h >= 44, `focused skip link is on screen and ${Math.round(sk.w)}x${Math.round(sk.h)} px`);
    check(/solid 3px rgb\(27, 10, 51\)/.test(sk.outline) && /rgb\(77, 255, 195\).*6px/.test(sk.shadow), `skip link focus = dark 3px ring + 6px mint halo (${sk.outline}; ${sk.shadow})`);
    check(!outlineProblems.length, `every focused element shows a 3px solid outline${outlineProblems.length ? ": " + outlineProblems.join("; ") : ""}`);
    check(!visProblems.length, `every focused element is in view and unobscured${visProblems.length ? ": " + visProblems.join("; ") : ""}`);

    const links = await s.exec(`return [...document.querySelectorAll('a[href^="#"]')].map((a,i)=>({i, text:(a.getAttribute('aria-label')||a.textContent).trim().replace(/[→↑]/g,'').trim(), href:a.getAttribute('href')}));`);
    for (const l of links) {
      await s.go(URL + "?k=" + Date.now()); await sleep(250);
      await s.exec(`window.scrollTo({top: arguments[0] === '#top' ? document.documentElement.scrollHeight : 0, behavior: 'instant'}); document.querySelectorAll('a[href^="#"]')[arguments[1]].focus({preventScroll:true});`, [l.href, l.i]);
      await s.enter();
      // Wait for (smooth) scrolling to settle instead of a fixed delay.
      let last = -1;
      for (let t = 0; t < 30; t++) { await sleep(150); const y = await s.exec("return scrollY;"); if (y === last) break; last = y; }
      const r = await s.exec(`const t=document.getElementById(arguments[0]); const tr=t.getBoundingClientRect();
        return {hash:location.hash, active:document.activeElement.id, top:tr.top, vh:innerHeight, sy:scrollY,
          banner:document.querySelector('.demo-banner').getBoundingClientRect().top};`, [l.href.slice(1)]);
      let ok, detail;
      if (l.href === "#main") { ok = r.active === "main"; detail = `focus moved to #${r.active}`; }
      else if (l.href === "#top") { ok = r.sy === 0 && r.banner === 0; detail = `scrollY ${r.sy}, banner top ${r.banner}px`; }
      else { ok = r.hash === l.href && r.top >= 0 && r.top < r.vh / 2; detail = `target top ${Math.round(r.top)}px`; }
      check(ok, `Enter on "${l.text}" -> ${l.href}: ${detail}`);
    }

    if (vp.w < 1000) {
      await s.go(URL + "?k=" + Date.now()); await sleep(300);
      for (let i = 0; i < 12; i++) {
        await s.tab();
        if ((await s.exec("return document.activeElement.textContent.trim();")).startsWith("Taste the orbit")) break;
      }
      await s.exec(`const st=document.createElement('style'); st.textContent=arguments[0]; document.head.appendChild(st);`, [CAPTURE_CSS]);
      await sleep(200);
      const fv = await s.exec("return {w: innerWidth, h: innerHeight};");
      savePng(await wd("GET", `/session/${s.id}/screenshot`), `focus-cta-${fv.w}x${fv.h}-window.png`, { w: fv.w, h: fv.h }, `${fv.w}x${fv.h} real window, keyboard focus on primary CTA`);
    }
  }

  await s.viewport(1440, 900); await s.go(URL); await sleep(300);
  const anim = await s.exec(`return {can:getComputedStyle(document.querySelector('.can')).animationName, bub:getComputedStyle(document.querySelector('.bubbles span')).animationName};`);
  console.log("Motion");
  check(anim.can === "float" && anim.bub === "rise", `can floats and bubbles rise when motion allowed (${anim.can}, ${anim.bub})`);
} finally { await s.quit(); }

console.log("Reduced motion");
const r = await newSession({ "ui.prefersReducedMotion": 1 });
try {
  await r.viewport(1440, 900);
  await r.go(URL); await sleep(300);
  const res = await r.exec(`return {mq:matchMedia('(prefers-reduced-motion: reduce)').matches,
    can:getComputedStyle(document.querySelector('.can')).animationName, bub:getComputedStyle(document.querySelector('.bubbles span')).animationName,
    moon:getComputedStyle(document.querySelector('.moon')).animationName, scroll:getComputedStyle(document.documentElement).scrollBehavior,
    btn:getComputedStyle(document.querySelector('.btn')).transitionDuration};`);
  check(res.mq, "prefers-reduced-motion matches with pref set");
  check(res.can === "none" && res.bub === "none" && res.moon === "none", `all animations disabled (${res.can}, ${res.bub}, ${res.moon})`);
  check(res.scroll === "auto", `smooth scroll disabled (${res.scroll})`);
  check(/^0s/.test(res.btn), `button transitions disabled (${res.btn})`);
} finally { await r.quit(); }

writeFileSync(join(SHOT_DIR, "artifacts.json"), JSON.stringify({ url: URL, generatedBy: "scripts/browser-check.mjs", artifacts }, null, 2) + "\n");
console.log(`\nArtifacts (${artifacts.length}):`);
for (const a of artifacts) console.log(`  ${a.file}  ${a.pngWidth}x${a.pngHeight}  ${a.note}`);
console.log(`\n${passes} passed, ${failures} failed`);
cleanup();
process.exit(failures ? 1 : 0);
