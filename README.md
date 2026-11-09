# Glorbit: fictional soda landing page

A one-page landing page for **Glorbit Dragonfruit Yuzu Fizz**, a made-up canned soda: "A tiny planet of fizz."
It is a design demo. Glorbit isn't real: there's nothing for sale, no checkout, and no health, nutrition or ingredient claims.

- Plain static HTML + CSS. No build step, no JavaScript, no dependencies, no external fonts, CDNs or trackers.
- All artwork (can, orbit, flavor icons, lineup, favicon) is inline/hand-written SVG.
- Mobile-first layout (breakpoints at 40rem and 60rem), skip link, visible 3px focus rings,
  `prefers-reduced-motion` support. Colour contrast was designed and checked against WCAG 2.x thresholds
  (see limits below); this is not a full accessibility audit or certification.

## Run locally

```sh
npm run preview          # python3 -m http.server 4173 --bind 127.0.0.1
# open http://127.0.0.1:4173/
```

## Checks

```sh
npm run check            # static structure/content/contrast checks (Node only)
npm run browser-check    # real Firefox via geckodriver; needs the preview server running
```

`browser-check` needs `geckodriver` and Firefox on `PATH`. It writes screenshots to `screenshots/`
(override with `SHOT_DIR=...`) and checks:

- Layout at 320, 390, 768 and 1440 px: no horizontal overflow, correct breakpoint, whole can and h1 inside
  the first screen.
- The whole primary CTA ("Taste the orbit") inside the first screen at 320x640, 390x844, 768x1024 and
  1440x900; its bounding box is logged for each size. Below 24rem (384 px) a compact hero rule tightens the
  banner, puts the nav on one row and shrinks the can so this holds at 320x640; 390 px and up are unchanged.
- Rendered target size: every focusable control is measured with `getBoundingClientRect` at 320, 390, 768
  and 1440 px and must be at least 44x44 CSS px. The focused skip link is measured separately.
- Keyboard: full Tab order, 3px focus outline on every stop, each focused control in view and not covered,
  and Enter on every in-page link lands on its target (skip link moves focus to `<main>`).
- `prefers-reduced-motion`: animations, smooth scrolling and button transitions turn off.

## Known limits of the checks

- **Contrast** is calculated with the WCAG 2.x formula on flat colour pairs taken from the CSS custom
  properties, plus one worst-case composite for the hero (both radial glows stacked at peak alpha over the
  page background). Not covered: other gradient positions, anti-aliased edges, text shadows, text drawn
  inside the can SVG (decorative and in an `aria-hidden` subtree or a labelled image), and hover states.
  Rendered pixels are not sampled.
- **Focus indicators** are checked for presence (3px solid outline), visibility and colour against the main
  background each ring sits on. Rings drawn over gradients are covered only by the hero worst-case composite.
- **Browsers/devices:** headless Firefox only. It can't make a window narrower than about 500 CSS px, so the
  320/390/768 px layouts are rendered in a same-origin iframe of exactly that size, and keyboard tests run in
  real 500 px and 1440 px windows. No Chrome/Safari, real-device or screen-reader testing.
