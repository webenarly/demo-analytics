/**
 * charts.js — hand-drawn SVG/CSS charts and number animation. No libraries.
 *
 * Every animation here is driven by toggling a class (`.is-drawn`) or by a CSS
 * variable, and the CSS only animates `transform` and `opacity`:
 *   - line chart: a cover rectangle slides away (reveals the line left to right)
 *   - bar chart : bars scale up from the baseline, staggered
 *   - ring      : two half-rings rotate (see .ring in components.css)
 *   - numbers   : requestAnimationFrame text updates (no layout-affecting CSS)
 * Durations come from CSS tokens, so mobile and reduced-motion are honoured.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
let uid = 0;

/* ---- Small helpers ------------------------------------------------------ */

/** Read a unitless numeric CSS custom property from :root. */
export function readToken(name, fallback) {
  const value = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
  return Number.isFinite(value) ? value : fallback;
}

/** 1 = full motion, ~0.6 = small screens, 0 = prefers-reduced-motion. */
export const getMotionScale = () => readToken('--motion-scale', 1);

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

/** Create an SVG element with attributes and optionally append it. */
function svg(tag, attrs = {}, parent) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  if (parent) parent.appendChild(node);
  return node;
}

/** Re-run `callback` when the host's width changes (charts redraw crisply). */
function observeWidth(host, callback) {
  let width = Math.round(host.clientWidth);
  const observer = new ResizeObserver(() => {
    const next = Math.round(host.clientWidth);
    if (Math.abs(next - width) > 1) {
      width = next;
      callback();
    }
  });
  observer.observe(host);
  return observer;
}

/** Smooth path through points (Catmull-Rom converted to cubic Béziers). */
function smoothPath(points) {
  const f = (n) => n.toFixed(1);
  let d = `M${f(points[0][0])},${f(points[0][1])}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${f(c1[0])},${f(c1[1])} ${f(c2[0])},${f(c2[1])} ${f(p2[0])},${f(p2[1])}`;
  }
  return d;
}

/** Greedy word wrap for SVG labels. */
function wrapLabel(text, maxChars) {
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/* ---- Number count-up + score ring --------------------------------------- */

/**
 * Animate a number from 0 to `to`.
 * @param {HTMLElement} el
 * @param {number} to
 * @param {{duration?: number, formatter?: (v:number)=>string, onFrame?: (eased:number, value:number)=>void}} [options]
 *   duration is the full-motion duration in ms; it is scaled by --motion-scale.
 *   With reduced motion the final value is written immediately.
 */
export function countUp(el, to, { duration = 1200, formatter = (v) => String(Math.round(v)), onFrame } = {}) {
  const total = duration * getMotionScale();
  if (total <= 0) {
    el.textContent = formatter(to);
    if (onFrame) onFrame(1, to);
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / total);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      el.textContent = formatter(to * eased);
      if (onFrame) onFrame(eased, to * eased);
      if (t < 1) requestAnimationFrame(tick);
      else resolve();
    };
    requestAnimationFrame(tick);
  });
}

/** Count the ring's number up while driving its --p (0..1) progress variable. */
export function animateRing(ringEl, valueEl, score, max = 100) {
  return countUp(valueEl, score, {
    duration: readToken('--count-ms', 1200) * 1.2,
    onFrame: (eased) => ringEl.style.setProperty('--p', ((score / max) * eased).toFixed(4)),
  });
}

/* ---- Sparkline ---------------------------------------------------------- */

/** Tiny trend line. Returns { play }. */
export function createSparkline(host, values) {
  const W = 96, H = 32, pad = 3;
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [
    pad + (i * (W - 2 * pad)) / (values.length - 1),
    H - pad - ((v - min) / span) * (H - 2 * pad),
  ]);
  host.classList.add('spark');
  host.replaceChildren();
  const el = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, 'aria-hidden': 'true', focusable: 'false' }, host);
  svg('path', { class: 'spark__line', d: smoothPath(pts) }, el);
  return {
    play() {
      void host.offsetWidth; // flush styles so the transition runs
      host.classList.add('is-drawn');
    },
  };
}

/* ---- Line chart --------------------------------------------------------- */

/**
 * Animated line chart with hover / touch / keyboard read-out.
 * @param {HTMLElement} host
 * @param {{labels: string[], values: number[], yMax?: number, unit?: string, name?: string}} cfg
 * @returns {{play: () => void, destroy: () => void}}
 */
export function createLineChart(host, { labels, values, yMax = 100, unit = '%', name = 'Value' }) {
  const id = ++uid;
  const M = { top: 14, right: 18, bottom: 30, left: 38 };
  const n = values.length;
  const baseClass = host.className;
  const ac = new AbortController();
  const { signal } = ac;
  let svgEl = null, guide = null, dot = null, geo = null;
  let played = false;
  let active = n - 1;

  host.classList.add('chart', 'chart--line');
  host.setAttribute('role', 'group');
  host.setAttribute('tabindex', '0');
  host.setAttribute('aria-label', `${name} over time, ${labels[0]} to ${labels[n - 1]}. Use the left and right arrow keys to read each week.`);

  const tip = document.createElement('div');
  tip.className = 'chart__tooltip';
  tip.setAttribute('aria-hidden', 'true');
  const live = document.createElement('p');
  live.className = 'sr-only';
  live.setAttribute('aria-live', 'polite');
  host.append(tip, live);

  function setActive(index, { announce = false } = {}) {
    active = clamp(index, 0, n - 1);
    if (!geo) return;
    const px = geo.x(active);
    const py = geo.y(values[active]);
    guide.style.transform = `translate(${px}px, 0)`;
    dot.style.transform = `translate(${px}px, ${py}px)`;
    tip.textContent = `${labels[active]} · ${values[active]}${unit}`;
    const tx = clamp(px - tip.offsetWidth / 2, 0, geo.W - tip.offsetWidth);
    const ty = Math.max(0, py - tip.offsetHeight - 12);
    tip.style.transform = `translate(${tx}px, ${ty}px)`;
    if (announce) live.textContent = `${labels[active]}: ${values[active]}${unit}`;
  }

  function render() {
    const W = Math.max(Math.round(host.clientWidth), 280);
    const H = W < 520 ? 220 : 280;
    const iw = W - M.left - M.right;
    const ih = H - M.top - M.bottom;
    const x = (i) => M.left + (n === 1 ? iw / 2 : (i * iw) / (n - 1));
    const y = (v) => M.top + ih - (v / yMax) * ih;
    geo = { W, H, iw, ih, x, y };

    if (svgEl) svgEl.remove();
    svgEl = svg('svg', { class: 'chart__svg', viewBox: `0 0 ${W} ${H}`, 'aria-hidden': 'true', focusable: 'false' });
    host.insertBefore(svgEl, tip);

    const gradId = `area-${id}`;
    const grad = svg('linearGradient', { id: gradId, x1: 0, y1: 0, x2: 0, y2: 1 }, svg('defs', {}, svgEl));
    svg('stop', { offset: '0%', class: 'chart__stop--top' }, grad);
    svg('stop', { offset: '100%', class: 'chart__stop--bottom' }, grad);

    // Gridlines first, so the line sits on top.
    const ticks = 4;
    for (let t = 0; t <= ticks; t++) {
      const ty = y((yMax / ticks) * t);
      svg('line', { class: `chart__grid${t === 0 ? ' chart__grid--base' : ''}`, x1: M.left, x2: M.left + iw, y1: ty, y2: ty }, svgEl);
    }

    const points = values.map((v, i) => [x(i), y(v)]);
    const d = smoothPath(points);
    svg('path', { d: `${d} L${x(n - 1)},${y(0)} L${x(0)},${y(0)} Z`, fill: `url(#${gradId})` }, svgEl);
    svg('path', { class: 'chart__line', d }, svgEl);

    // The cover hides line + grid until the chart plays, then slides away.
    svg('rect', { class: 'chart__cover', x: M.left - 2, y: 0, width: iw + M.right + 4, height: H - M.bottom + 1 }, svgEl);

    // Axis labels (outside the cover, always visible).
    for (let t = 0; t <= ticks; t++) {
      const label = svg('text', { class: 'chart__tick', x: M.left - 8, y: y((yMax / ticks) * t) + 4, 'text-anchor': 'end' }, svgEl);
      label.textContent = Math.round((yMax / ticks) * t);
    }
    const step = W < 520 ? 3 : 2;
    labels.forEach((text, i) => {
      if ((n - 1 - i) % step !== 0) return;
      const label = svg('text', { class: 'chart__tick', x: x(i), y: H - 8, 'text-anchor': 'middle' }, svgEl);
      label.textContent = text;
    });

    // Marker: dashed guide + dot, moved with CSS transforms.
    const marker = svg('g', { class: 'chart__marker' }, svgEl);
    guide = svg('g', { class: 'chart__guide' }, marker);
    svg('line', { x1: 0, x2: 0, y1: M.top, y2: M.top + ih }, guide);
    dot = svg('g', { class: 'chart__dot' }, marker);
    svg('circle', { r: 5.5 }, dot);

    setActive(active);
  }

  const indexFromPointer = (event) => {
    const rect = svgEl.getBoundingClientRect();
    const px = (event.clientX - rect.left) * (geo.W / rect.width);
    return Math.round(((px - M.left) / geo.iw) * (n - 1));
  };
  const rest = () => {
    host.classList.remove('is-active');
    setActive(n - 1);
  };

  host.addEventListener('pointermove', (e) => { host.classList.add('is-active'); setActive(indexFromPointer(e)); }, { signal });
  host.addEventListener('pointerdown', (e) => { host.classList.add('is-active'); setActive(indexFromPointer(e)); }, { signal });
  host.addEventListener('pointerleave', () => { if (!host.matches(':focus-visible')) rest(); }, { signal });
  host.addEventListener('focus', () => { if (host.matches(':focus-visible')) { host.classList.add('is-active'); setActive(active, { announce: true }); } }, { signal });
  host.addEventListener('blur', rest, { signal });
  host.addEventListener('keydown', (e) => {
    const target = { ArrowLeft: active - 1, ArrowRight: active + 1, Home: 0, End: n - 1 }[e.key];
    if (target === undefined) return;
    e.preventDefault();
    host.classList.add('is-active');
    setActive(target, { announce: true });
  }, { signal });

  render();
  const observer = observeWidth(host, render);

  return {
    play() {
      if (played) return;
      played = true;
      void host.offsetWidth; // flush styles so the transitions run
      host.classList.add('is-drawn');
    },
    destroy() {
      observer.disconnect();
      ac.abort();
      host.replaceChildren();
      host.className = baseClass;
      ['role', 'tabindex', 'aria-label'].forEach((a) => host.removeAttribute(a));
    },
  };
}

/* ---- Bar chart ---------------------------------------------------------- */

/**
 * Animated vertical bar chart. The highlighted item uses the accent colour.
 * @param {HTMLElement} host
 * @param {{items: {label: string, value: number, highlight?: boolean}[], yMax?: number, unit?: string, name?: string}} cfg
 * @returns {{play: () => void, destroy: () => void}}
 */
export function createBarChart(host, { items, yMax = 100, unit = '%', name = 'Score' }) {
  const baseClass = host.className;
  const n = items.length;
  let svgEl = null;
  let played = false;

  host.classList.add('chart', 'chart--bars');
  host.setAttribute('role', 'img');
  host.setAttribute('aria-label', `${name}: ${items.map((i) => `${i.label} ${i.value}${unit}`).join(', ')}`);

  function render() {
    const W = Math.max(Math.round(host.clientWidth), 280);
    const M = { top: 28, right: 12, bottom: 0, left: 38 };
    const iw = W - M.left - M.right;
    const band = iw / n;
    const lines = items.map((it) => wrapLabel(it.label, Math.max(6, Math.floor(band / 6.8))));
    const maxLines = Math.max(...lines.map((l) => l.length));
    M.bottom = 14 + maxLines * 15;
    const H = W < 520 ? 240 : 300;
    const ih = H - M.top - M.bottom;
    const y = (v) => M.top + ih - (v / yMax) * ih;
    const barW = Math.min(72, band * 0.56);

    if (svgEl) svgEl.remove();
    svgEl = svg('svg', { class: 'chart__svg', viewBox: `0 0 ${W} ${H}`, 'aria-hidden': 'true', focusable: 'false' });
    host.appendChild(svgEl);

    const ticks = 4;
    for (let t = 0; t <= ticks; t++) {
      const ty = y((yMax / ticks) * t);
      svg('line', { class: `chart__grid${t === 0 ? ' chart__grid--base' : ''}`, x1: M.left, x2: M.left + iw, y1: ty, y2: ty }, svgEl);
      const label = svg('text', { class: 'chart__tick', x: M.left - 8, y: ty + 4, 'text-anchor': 'end' }, svgEl);
      label.textContent = Math.round((yMax / ticks) * t);
    }

    items.forEach((item, i) => {
      const cx = M.left + band * i + band / 2;
      const top = y(item.value);
      const bar = svg('rect', {
        class: `chart__bar${item.highlight ? ' chart__bar--highlight' : ''}`,
        x: cx - barW / 2, y: top, width: barW, height: M.top + ih - top, rx: 5,
      }, svgEl);
      bar.style.setProperty('--i', i);

      const value = svg('text', { class: 'chart__value', x: cx, y: top - 8, 'text-anchor': 'middle' }, svgEl);
      value.textContent = `${item.value}${unit}`;
      value.style.setProperty('--i', i);

      lines[i].forEach((line, li) => {
        const text = svg('text', { class: 'chart__label', x: cx, y: M.top + ih + 18 + li * 15, 'text-anchor': 'middle' }, svgEl);
        if (item.highlight) text.style.fill = 'var(--color-text)';
        text.textContent = line;
      });
    });
  }

  render();
  const observer = observeWidth(host, render);

  return {
    play() {
      if (played) return;
      played = true;
      void host.offsetWidth;
      host.classList.add('is-drawn');
    },
    destroy() {
      observer.disconnect();
      host.replaceChildren();
      host.className = baseClass;
      ['role', 'aria-label'].forEach((a) => host.removeAttribute(a));
    },
  };
}
