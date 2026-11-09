// Dependency-free static checks for the Glorbit landing page.
// Usage: node scripts/check.mjs   (or: npm run check)
// Structural, content and colour-contrast checks only. Not a substitute for
// real-browser keyboard testing (scripts/browser-check.mjs) or a screen-reader audit.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(root, "index.html"), "utf8");
const css = readFileSync(join(root, "styles.css"), "utf8");

let failures = 0, passes = 0;
const check = (ok, label) => {
  ok ? passes++ : failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}`);
};
const body = html.slice(html.indexOf("<body"));
const text = body.replace(/<title[\s\S]*?<\/title>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

console.log("Document");
check(/<html lang="en">/.test(html), 'html has lang="en"');
check(/<meta name="viewport" content="width=device-width, initial-scale=1">/.test(html), "responsive viewport meta");
check(/<title>[^<]*Glorbit[^<]*fictional[^<]*<\/title>/i.test(html), "title names Glorbit and says fictional");
check((html.match(/<h1[\s>]/g) || []).length === 1, "exactly one h1");
for (const tag of ["header", "nav", "main", "footer"]) check(new RegExp(`<${tag}[\\s>]`).test(html), `<${tag}> landmark`);
check(/class="skip-link" href="#main"/.test(html) && /<main id="main" tabindex="-1"/.test(html), "skip link targets focusable main");
const levels = [...html.matchAll(/<h([1-6])[\s>]/g)].map((m) => +m[1]);
check(levels.every((l, i) => i === 0 || l <= levels[i - 1] + 1), `heading order without skips (${levels.join(",")})`);
const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
check(new Set(ids).size === ids.length, "all ids unique");
const anchors = [...html.matchAll(/href="#([^"]*)"/g)].map((m) => m[1]);
const broken = anchors.filter((a) => !ids.includes(a));
check(broken.length === 0, `all in-page anchors resolve${broken.length ? " (broken: " + broken.join(", ") + ")" : ""}`);
const refs = [...html.matchAll(/aria-labelledby="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/));
check(refs.every((id) => ids.includes(id)), "all aria-labelledby targets exist");

console.log("Imagery");
const canSvg = html.match(/<svg class="can"[\s\S]*?<\/svg>/)?.[0] || "";
check(/role="img"/.test(canSvg) && /aria-labelledby="can-title"/.test(canSvg) && /<title id="can-title">[^<]{20,}<\/title>/.test(canSvg), "hero can SVG is an image with a descriptive title");
const decorative = [...html.matchAll(/<svg(?![^>]*role="img")[^>]*>/g)].map((m) => m[0]);
check(decorative.every((t) => /aria-hidden="true"/.test(t) || /focusable="false"/.test(t)), `other ${decorative.length} SVGs are decorative (aria-hidden / inside aria-hidden)`);
check(!/<img[\s>]/i.test(html), "no raster images (all art is inline SVG)");

console.log("Brief: fictional, no commerce, no real claims");
const bannerIdx = html.indexOf('class="demo-banner"');
check(bannerIdx > 0 && bannerIdx < html.indexOf("<main"), "demo banner before main content");
check(/fictional soda/i.test(text) && /not made or sold anywhere/.test(text), "banner says fictional and not sold");
check(/fictional concept demo/i.test(html.slice(html.indexOf("<footer"))), "footer repeats fictional disclosure");
check(/no checkout or sign-up/.test(text), "about section states no checkout");
check(!/[$€£¥]\s?\d|\d\s?(USD|EUR)\b/.test(text), "no prices");
check(!/add to cart|buy now|shop now|order now|pre-?order|subscribe|sign up now|checkout now|in stock|free shipping/i.test(text), "no purchase CTAs");
check(!/<form[\s>]|<input[\s>]|<button[\s>]|<select[\s>]/i.test(html), "no forms or checkout controls");
check(!/<script[\s>]/i.test(html), "no scripts (no trackers; page works without JS)");
check(!/(src|href)="(https?:)?\/\//i.test(html) && !/url\(\s*["']?(https?:)?\/\//i.test(css) && !/@import/i.test(css), "no external resources");
check(!/\b\d+\s?(kcal|calories|cal|mg|g|ml|oz)\b|\b(zero|no|low)[- ]sugar\b|sugar[- ]free|vitamin|healthy|immun|detox|antioxidant|organic|all[- ]natural|keto|vegan/i.test(text), "no nutrition/health claims or specs");
check(!/award|best[- ]selling|#1|number one|testimonial|★|rated|reviews?\b/i.test(text), "no awards, ratings or testimonials");
check(!/coca|pepsi|sprite|fanta|red bull|monster|7up|dr pepper|la ?croix/i.test(text), "no real soda brand names");

console.log("CSS accessibility");
check(/:focus-visible\s*\{[^}]*outline:\s*3px solid/.test(css), "visible 3px :focus-visible outline");
check(/\.flavor :focus-visible, \.moments :focus-visible\s*\{\s*outline-color:\s*var\(--focus-dark\)/.test(css), "dark focus ring on light sections");
check(/@media \(prefers-reduced-motion: reduce\)/.test(css), "prefers-reduced-motion handled");
check(/@media \(min-width: 40rem\)/.test(css) && /@media \(min-width: 60rem\)/.test(css), "mobile-first breakpoints");
check(/min-height:\s*44px/.test(css) && /min-height:\s*3\.25rem/.test(css), "touch targets >= 44px");
check(!/content:\s*"[^"]+"/.test(css), "no CSS-generated text content");

console.log("Contrast: token pairs (WCAG 2.x formula; flat colours only)");
const vars = Object.fromEntries([...css.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]));
const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const c = (v) => (v.startsWith("#") ? v : vars[v]);
const pairs = [
  ["cream", "space", 4.5, "body text on space"],
  ["on-space-muted", "space", 4.5, "muted text on space"],
  ["on-space-muted", "space-2", 4.5, "muted text on space-2"],
  ["magenta", "space", 3, "magenta h1 / large numerals on space (large text 3:1)"],
  ["yuzu", "space", 4.5, "yuzu text on space (subtitle, footer link)"],
  ["yuzu", "space-3", 4.5, "yuzu eyebrow on space-3"],
  ["ink", "yuzu", 4.5, "ink on yuzu (banner, primary button, skip link)"],
  ["ink", "cream", 4.5, "ink on cream"],
  ["ink-muted", "cream", 4.5, "muted ink on cream"],
  ["ink-muted", "#ffffff", 4.5, "muted ink on white"],
  ["ink-muted", "#ffe3f0", 4.5, "muted ink on pink card"],
  ["ink-muted", "#fff7cc", 4.5, "muted ink on yuzu card"],
  ["ink-muted", "#dcfff3", 4.5, "muted ink on mint card"],
  ["focus", "space", 3, "mint focus ring on space (non-text 3:1)"],
  ["focus-dark", "cream", 3, "dark focus ring on cream (non-text 3:1)"],
  ["focus-dark", "yuzu", 3, "dark focus ring on skip link (non-text 3:1)"],
  ["cream", "space", 3, "ghost button border on space (non-text 3:1)"],
];
for (const [fg, bg, min, label] of pairs) {
  const r = ratio(c(fg), c(bg));
  check(r >= min, `${label}: ${c(fg)} on ${c(bg)} = ${r.toFixed(2)}:1 (min ${min})`);
}

console.log("Contrast: hero gradient worst case (both glows stacked at peak alpha over --space)");
// The hero background is two radial glows over --space. Composite both at their peak alpha
// (stronger than anywhere they actually overlap) and check every text/indicator colour used in the hero.
const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const rgbHex = (c) => "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
const over = (fg, a, bg) => fg.map((v, i) => v * a + bg[i] * (1 - a));
const glows = [...css.matchAll(/radial-gradient\([^,]+,\s*rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/g)].map((m) => ({ rgb: [+m[1], +m[2], +m[3]], a: +m[4] }));
check(glows.length === 2, `found ${glows.length} hero glow layers (${glows.map((g) => `rgba(${g.rgb},${g.a})`).join(", ")})`);
let worst = hexRgb(vars.space);
for (const g of [...glows].reverse()) worst = over(g.rgb, g.a, worst);
const worstHex = rgbHex(worst);
for (const [fg, min, label] of [
  ["magenta", 3, "magenta h1 (large text)"], ["yuzu", 4.5, "yuzu subtitle"], ["on-space-muted", 4.5, "lede"],
  ["cream", 4.5, "ghost button text"], ["cream", 3, "ghost button border (non-text)"], ["focus", 3, "mint focus ring (non-text)"],
]) {
  const r = ratio(vars[fg], worstHex);
  check(r >= min, `${label}: ${vars[fg]} on worst-case glow ${worstHex} = ${r.toFixed(2)}:1 (min ${min})`);
}
console.log("Focus indicator: skip link");
check(/\.skip-link:focus\s*\{[^}]*outline-offset:\s*0[^}]*box-shadow:\s*0 0 0 6px var\(--focus\)/.test(css), "skip link uses dark ring + mint halo");
check(ratio(vars["focus-dark"], vars.yuzu) >= 3 && ratio(vars.focus, vars.space) >= 3,
  `skip link ring: dark vs yellow pill ${ratio(vars["focus-dark"], vars.yuzu).toFixed(2)}:1, mint halo vs header ${ratio(vars.focus, vars.space).toFixed(2)}:1`);

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
