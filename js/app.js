/**
 * app.js — Demo Analytics entry point.
 *
 * Responsibilities
 *   1. Hash-based view switching (no reload) with a fade/slide transition.
 *   2. Loading data (data-loader.js) and rendering each view.
 *   3. Loading / empty / error states (live views + the States showcase).
 *   4. Scroll-triggered reveals and "play once when visible" animations,
 *      all through ONE IntersectionObserver (see onVisible()).
 *   5. The simulated analysis progress.
 *
 * Self-initiated demo. Sample data only.
 */
import { loadData } from './data-loader.js';
import {
  countUp, animateRing, createLineChart, createBarChart, createSparkline,
  getMotionScale, readToken,
} from './charts.js';

/* ==========================================================================
   Helpers
   ========================================================================== */
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nf = new Intl.NumberFormat('en-US');

/** Escape text before it goes into an innerHTML template. */
const esc = (value) => String(value).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

/* ==========================================================================
   View + data model
   ========================================================================== */
const VIEWS = {
  overview: { title: 'Overview', source: 'overview' },
  progress: { title: 'Analysis progress', source: 'report' },
  report: { title: 'Report', source: 'report' },
  states: { title: 'States showcase', source: null },
};

/** Which views depend on which JSON file. */
const SOURCE_VIEWS = { overview: ['overview'], report: ['progress', 'report'] };

/** status: 'loading' | 'ready' | 'empty' | 'error' */
const store = {
  overview: { status: 'loading', data: null, error: '' },
  report: { status: 'loading', data: null, error: '' },
};

let activeView = null;
let navToken = 0;

/* ==========================================================================
   Scroll-triggered animation: one shared IntersectionObserver
   ========================================================================== */
const visibleCallbacks = new WeakMap();
const observer = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    observer.unobserve(entry.target); // play once
    const callback = visibleCallbacks.get(entry.target);
    if (callback) callback(entry.target);
  }
}, { threshold: 0.12, rootMargin: '0px 0px -4% 0px' });

/** Run `callback` the first time `el` scrolls into view. */
function onVisible(el, callback) {
  visibleCallbacks.set(el, callback);
  observer.observe(el);
}

/** Wire up every [data-reveal] element under `root` (staggered by sibling index). */
function registerReveals(root = document) {
  const scale = getMotionScale();
  $$('[data-reveal]:not([data-observed])', root).forEach((el) => {
    el.dataset.observed = '';
    const index = [...el.parentElement.children].indexOf(el);
    el.style.setProperty('--reveal-delay', `${Math.min(index, 6) * 70 * scale}ms`);
    onVisible(el, (target) => target.classList.add('is-visible'));
  });
}

/** Show `0`, then count up to `to` when scrolled into view. Screen readers get the final value. */
function prepCount(el, to, formatter = (v) => String(Math.round(v))) {
  el.textContent = formatter(0);
  el.setAttribute('aria-hidden', 'true');
  let sr = el.nextElementSibling;
  if (!sr || !sr.hasAttribute('data-count-sr')) {
    sr = document.createElement('span');
    sr.className = 'sr-only';
    sr.setAttribute('data-count-sr', '');
    el.after(sr);
  }
  sr.textContent = formatter(to);
  onVisible(el, () => countUp(el, to, { duration: readToken('--count-ms', 1200), formatter }));
}

/* ==========================================================================
   State templates (shared by the live views and the States showcase)
   ========================================================================== */
const ICON_EMPTY = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/></svg>';
const ICON_ERROR = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 3l10 18H2z"/><path d="M12 10v4.5M12 17.6v.01"/></svg>';

const repeat = (html, n) => html.repeat(n);
const SKELETONS = {
  overview: `<div class="skeleton-grid">${repeat('<div class="skeleton skeleton--card"></div>', 4)}</div><div class="skeleton skeleton--chart"></div>`,
  progress: `<div class="skeleton skeleton--title"></div><div class="skeleton skeleton--bar"></div>${repeat('<div class="skeleton skeleton--row"></div>', 4)}`,
  report: `<div class="skeleton skeleton--title"></div>${repeat('<div class="skeleton skeleton--row"></div>', 3)}<div class="skeleton skeleton--table"></div>`,
};

const COPY = {
  overview: {
    noun: 'overview',
    empty: { title: 'No visibility data yet', text: 'Run your first analysis and we will show how often your store is mentioned in AI answers.', action: 'Run first analysis', go: 'progress' },
    error: { title: 'We couldn’t load the overview', text: 'The data didn’t load. Check your connection and try again.' },
  },
  progress: {
    noun: 'analysis progress',
    empty: { title: 'Nothing is being analyzed', text: 'Connect a store to start an analysis and follow each step here.', action: 'Connect a store', go: '' },
    error: { title: 'The analysis was interrupted', text: 'Something stopped the run before it finished. Nothing was lost, so you can safely retry.' },
  },
  report: {
    noun: 'report',
    empty: { title: 'No report yet', text: 'Your report appears here once an analysis has finished.', action: 'See analysis progress', go: 'progress' },
    error: { title: 'The report is unavailable', text: 'We couldn’t build the report just now. Please try again in a moment.' },
  },
};

/**
 * Markup for one state of one view.
 * @param {'loading'|'empty'|'error'} kind
 * @param {'overview'|'progress'|'report'} view
 * @param {{preview?: boolean, detail?: string}} [options]  preview = no alert roles (showcase)
 */
function stateMarkup(kind, view, { preview = false, detail = '' } = {}) {
  const copy = COPY[view];
  if (kind === 'loading') {
    return `<div class="state state--loading"${preview ? '' : ' role="status"'}>
      <span class="sr-only">Loading ${copy.noun}…</span>
      <div class="state__skeleton" aria-hidden="true">${SKELETONS[view]}</div>
    </div>`;
  }
  if (kind === 'empty') {
    const { title, text, action, go } = copy.empty;
    return `<div class="state state--empty">
      <span class="state__icon">${ICON_EMPTY}</span>
      <p class="state__title">${title}</p>
      <p class="state__text">${text}</p>
      <button class="btn btn--primary" type="button" data-action="${go ? 'go' : 'demo'}" data-go="${go}">${action}</button>
    </div>`;
  }
  const { title, text } = copy.error;
  return `<div class="state state--error"${preview ? '' : ' role="alert"'}>
    <span class="state__icon">${ICON_ERROR}</span>
    <p class="state__title">${title}</p>
    <p class="state__text">${text}</p>
    ${detail ? `<p class="state__detail">${esc(detail)}</p>` : ''}
    <button class="btn btn--primary" type="button" data-action="retry" data-source="${VIEWS[view].source || ''}">
      <svg class="btn__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 12a8 8 0 1 0 2.6-5.9M4 4v4h4"/></svg>Retry
    </button>
  </div>`;
}

/** Put a live view into a state; 'ready' reveals its content. */
function setViewState(view, status, source) {
  const section = $(`#view-${view}`);
  const slot = $('[data-state-slot]', section);
  const content = $('[data-content]', section);
  section.dataset.status = status;
  if (status === 'ready') {
    slot.replaceChildren();
    content.hidden = false;
  } else {
    content.hidden = true;
    slot.innerHTML = stateMarkup(status, view, { detail: status === 'error' ? store[source].error : '' });
  }
}

function applyStatus(source, status) {
  store[source].status = status;
  SOURCE_VIEWS[source].forEach((view) => setViewState(view, status, source));
}

/* ==========================================================================
   Toast (demo feedback for buttons that have no real backend)
   ========================================================================== */
let toastTimer = 0;
function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-visible'), 3400);
}

/* ==========================================================================
   KPI helpers
   ========================================================================== */
const ARROWS = {
  up: '<svg class="delta__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
  down: '<svg class="delta__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 5v14M5 12l7 7 7-7"/></svg>',
  flat: '<svg class="delta__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 12h14"/></svg>',
};

/** Delta pill. The sign and arrow carry meaning too, not only colour. */
function deltaHTML(change, text, context) {
  const dir = change > 0 ? 'up' : change < 0 ? 'down' : 'flat';
  return `<span class="delta delta--${dir}">${ARROWS[dir]}${esc(text)}</span><span>${esc(context)}</span>`;
}
const signed = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n)}`;

/* ==========================================================================
   Overview
   ========================================================================== */
const charts = [];

function disposeCharts() {
  charts.splice(0).forEach((chart) => chart.destroy());
}

function renderOverview(data) {
  disposeCharts();
  $$('[data-store]').forEach((node) => { node.textContent = data.meta.store; });
  $('#period-chip').textContent = data.meta.periodLabel;

  const { visibilityScore: score, mentions, competitorRank: rank, trend } = data.kpis;
  const series = data.visibilitySeries;

  // KPI numbers count up when scrolled into view.
  prepCount($('[data-kpi="score"]'), score.value);
  prepCount($('[data-kpi="mentions"]'), mentions.value, (v) => nf.format(Math.round(v)));
  prepCount($('[data-kpi="trend"]'), trend.changePoints, (v) => signed(Math.round(v)));
  $('[data-kpi="rank"]').textContent = `#${rank.value}`;
  $('[data-kpi-total]').textContent = `of ${rank.total}`;

  const scoreDelta = score.value - score.previous;
  $('[data-kpi-foot="score"]').innerHTML = deltaHTML(scoreDelta, `${signed(scoreDelta)} pts`, 'vs previous period');
  const mentionPct = ((mentions.value - mentions.previous) / mentions.previous) * 100;
  $('[data-kpi-foot="mentions"]').innerHTML = deltaHTML(mentionPct, `${signed(Math.round(mentionPct * 10) / 10)}%`, 'vs previous period');
  const placesGained = rank.previous - rank.value;
  $('[data-kpi-foot="rank"]').innerHTML = deltaHTML(
    placesGained,
    placesGained === 0 ? 'No change' : `${placesGained > 0 ? 'Up' : 'Down'} ${Math.abs(placesGained)}`,
    `from #${rank.previous}`,
  );
  $('[data-kpi-foot="trend"]').textContent = `over ${trend.windowWeeks} weeks`;

  const spark = createSparkline($('#spark'), series.values);
  onVisible($('#spark'), () => spark.play());

  // Score ring: number and ring progress animate together.
  const ring = $('#ring');
  ring.style.setProperty('--p', '0');
  ring.setAttribute('aria-label', `Visibility score: ${score.value} out of ${score.max}`);
  const ringValue = $('[data-ring-value]');
  ringValue.textContent = '0';
  onVisible(ring, () => animateRing(ring, ringValue, score.value, score.max));

  // Line chart.
  const lineHost = $('#chart-line');
  const line = createLineChart(lineHost, { labels: series.labels, values: series.values, unit: series.unit, name: 'Visibility score' });
  charts.push(line);
  onVisible(lineHost, () => line.play());

  // Bar chart: store vs competitors, highest first.
  const barHost = $('#chart-bars');
  const items = [...data.competitors]
    .sort((a, b) => b.score - a.score)
    .map((c) => ({ label: c.name, value: c.score, highlight: c.isStore }));
  const bars = createBarChart(barHost, { items, unit: series.unit, name: 'Visibility score by brand' });
  charts.push(bars);
  onVisible(barHost, () => bars.play());

  registerReveals($('#view-overview'));
}

/* ==========================================================================
   Report
   ========================================================================== */
function priorityIcon(level) {
  const filled = { high: 3, medium: 2, low: 1 }[level] || 1;
  const bar = (i, x, y, h) => `<rect${i >= filled ? ' class="is-off"' : ''} x="${x}" y="${y}" width="3.4" height="${h}" rx="1"/>`;
  return `<svg class="priority__icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">${bar(0, 1.8, 9, 5)}${bar(1, 6.3, 5.5, 8.5)}${bar(2, 10.8, 2, 12)}</svg>`;
}

function renderReport(data) {
  $('#report-summary').textContent = data.summary;

  // Citations: source, type, count, relative bar.
  const maxCount = Math.max(...data.citations.map((c) => c.count), 1);
  $('#citations-list').innerHTML = data.citations.map((c) => `
    <li class="citation" data-reveal style="--w:${(c.count / maxCount).toFixed(3)}">
      <div>
        <p class="citation__source">${esc(c.source)}</p>
        <p class="citation__meta"><span class="chip chip--quiet">${esc(c.type)}</span><span>${esc(c.domain)}</span></p>
      </div>
      <p class="citation__count"><span class="citation__num">${nf.format(c.count)}</span> citations</p>
      <div class="citation__bar" aria-hidden="true"><span class="citation__fill"></span></div>
    </li>`).join('');

  // Competitors table.
  $('#competitor-rows').innerHTML = data.competitors.map((c) => `
    <tr${c.isStore ? ' class="table__row--store"' : ''}>
      <th scope="row" class="table__name">${esc(c.name)}${c.isStore ? ' <span class="chip chip--quiet">You</span>' : ''}</th>
      <td class="num">${c.visibility}%</td>
      <td class="num">${nf.format(c.mentions)}</td>
      <td class="num">${c.avgPosition.toFixed(1)}</td>
      <td class="num">${c.positiveSentiment}%</td>
      <td class="num">${signed(c.change)} pts</td>
    </tr>`).join('');

  // Recommendation cards with priority labels (icon + text, not colour alone).
  const label = { high: 'High priority', medium: 'Medium priority', low: 'Low priority' };
  $('#rec-list').innerHTML = data.recommendations.map((r) => `
    <li class="card card--hover rec" data-reveal>
      <div class="rec__top">
        <span class="priority priority--${esc(r.priority)}">${priorityIcon(r.priority)}${label[r.priority] || 'Priority'}</span>
        <span class="rec__meta">Impact: ${esc(r.impact)} · Effort: ${esc(r.effort)}</span>
      </div>
      <h3 class="rec__title">${esc(r.title)}</h3>
      <p class="rec__text">${esc(r.description)}</p>
    </li>`).join('');

  registerReveals($('#view-report'));
}

/* ==========================================================================
   Analysis progress (simulated; no real API)
   ========================================================================== */
const progress = { steps: [], raf: 0, started: false, pct: -1 };

function stepMarkup(step) {
  return `<li class="steps__item" data-status="pending">
    <span class="steps__icon" aria-hidden="true">
      <svg class="steps__check" viewBox="0 0 24 24" focusable="false"><path d="M6 12.5l4 4 8-9"/></svg>
      <span class="steps__spinner"></span>
    </span>
    <div>
      <p class="steps__label">${esc(step.label)}</p>
      <p class="steps__desc">${esc(step.description)}</p>
    </div>
    <span class="steps__badge">Pending</span>
  </li>`;
}

function setProgress(fraction) {
  $('#progress-fill').style.transform = `scaleX(${fraction.toFixed(4)})`;
  const pct = Math.round(fraction * 100);
  if (pct !== progress.pct) {
    progress.pct = pct;
    $('#progress-pct').textContent = `${pct}%`;
    $('#progress-bar').setAttribute('aria-valuenow', String(pct));
  }
}

/** Paint step statuses. index -1 = idle, index >= steps.length = complete. */
function paintSteps(index) {
  const total = progress.steps.length;
  const badge = { done: 'Done', active: 'In progress', pending: 'Pending' };
  $$('.steps__item').forEach((item, i) => {
    const status = i < index ? 'done' : i === index ? 'active' : 'pending';
    item.dataset.status = status;
    $('.steps__badge', item).textContent = badge[status];
    if (status === 'active') item.setAttribute('aria-current', 'step');
    else item.removeAttribute('aria-current');
  });
  $('#progress-status').textContent = index < 0
    ? 'Ready to start'
    : index >= total
      ? 'Analysis complete. Your report is ready.'
      : `Step ${index + 1} of ${total}: ${progress.steps[index].label}`;
  $('#progress-done').hidden = index < total;
}

function runProgress() {
  cancelAnimationFrame(progress.raf);
  const durations = progress.steps.map((s) => s.durationMs * Math.max(getMotionScale(), 0.15));
  const total = durations.reduce((a, b) => a + b, 0);
  const start = performance.now();
  let current = -2;
  progress.pct = -1;

  const tick = (now) => {
    const elapsed = now - start;
    let index = durations.length;
    let acc = 0;
    for (let i = 0; i < durations.length; i++) {
      if (elapsed < acc + durations[i]) { index = i; break; }
      acc += durations[i];
    }
    if (index !== current) { current = index; paintSteps(index); }
    const fraction = Math.min(1, elapsed / total);
    setProgress(fraction);
    if (fraction < 1) progress.raf = requestAnimationFrame(tick);
  };
  progress.raf = requestAnimationFrame(tick);
}

function renderProgress(data) {
  cancelAnimationFrame(progress.raf);
  progress.steps = data.analysis.steps;
  progress.started = false;
  $$('[data-store]').forEach((node) => { node.textContent = data.meta.store; });
  $('#steps-list').innerHTML = progress.steps.map(stepMarkup).join('');
  $('#progress-detail').textContent = `${data.analysis.questionsSampled} sample questions`;
  progress.pct = -1;
  setProgress(0);
  paintSteps(-1);
  registerReveals($('#view-progress'));
  maybeStartProgress();
}

/** Auto-run the simulation the first time the Progress view is on screen. */
function maybeStartProgress() {
  if (activeView === 'progress' && store.report.status === 'ready' && !progress.started) {
    progress.started = true;
    runProgress();
  }
}

/* ==========================================================================
   Data loading
   ========================================================================== */
const isEmpty = {
  overview: (d) => !d?.visibilitySeries?.values?.length,
  report: (d) => !d?.analysis?.steps?.length || !(d.citations?.length || d.competitors?.length || d.recommendations?.length),
};

async function loadSource(name) {
  applyStatus(name, 'loading');
  try {
    const data = await loadData(name, { force: true });
    store[name].data = data;
    if (isEmpty[name](data)) {
      applyStatus(name, 'empty');
      return;
    }
    applyStatus(name, 'ready'); // reveal first so charts can measure their width
    if (name === 'overview') {
      renderOverview(data);
    } else {
      renderReport(data);
      renderProgress(data);
    }
  } catch (error) {
    store[name].error = error?.message || 'Unknown error';
    applyStatus(name, 'error');
  }
}

const loadAll = () => Promise.all(Object.keys(store).map(loadSource));

/* ==========================================================================
   Navigation (hash routing, no reload)
   ========================================================================== */
const viewFromHash = () => {
  const id = location.hash.slice(1);
  return Object.hasOwn(VIEWS, id) ? id : 'overview';
};

async function showView(id, { focus = false } = {}) {
  if (id === activeView) return;
  const token = ++navToken;
  const previous = activeView && $(`#view-${activeView}`);
  const next = $(`#view-${id}`);
  activeView = id;

  $$('[data-nav]').forEach((link) => {
    if (link.dataset.nav === id) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  $('#page-title').textContent = VIEWS[id].title;
  document.title = `${VIEWS[id].title} · Demo Analytics (self-initiated demo)`;

  // Fade the old view out, then swap.
  if (previous) {
    previous.classList.add('is-leaving');
    const out = readToken('--view-out-ms', 120) * getMotionScale();
    if (out > 0) await sleep(out);
  }
  $$('.view').forEach((view) => {
    if (view !== next) { view.hidden = true; view.classList.remove('is-leaving'); }
  });
  if (token !== navToken) return; // user navigated again meanwhile

  next.hidden = false;
  next.classList.add('is-entering');
  setTimeout(() => next.classList.remove('is-entering'), 320);
  window.scrollTo(0, 0);
  if (focus) $('#page-title').focus({ preventScroll: true });
  maybeStartProgress();
}

/* ==========================================================================
   States showcase
   ========================================================================== */
function initShowcase() {
  const paint = (kind) => $$('[data-preview]').forEach((box) => {
    box.innerHTML = stateMarkup(kind, box.dataset.preview, { preview: true });
  });
  $$('input[name="preview-state"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      paint(radio.value);
      $('#states-live').textContent = `Previewing the ${radio.value} state for every view.`;
    });
  });
  paint('loading');
}

/* ==========================================================================
   Boot
   ========================================================================== */
function init() {
  // One delegated handler for every state button (live views and showcase).
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const { action } = button.dataset;
    if (button.closest('[data-preview]')) {
      toast(action === 'retry' ? 'Demo only: in the live app, Retry would request the data again.' : 'Demo only: this button would take you to the next step.');
    } else if (action === 'retry') {
      loadSource(button.dataset.source);
    } else if (action === 'go') {
      location.hash = button.dataset.go;
    } else {
      toast('Demo only: no real store is connected.');
    }
  });

  $('#progress-replay').addEventListener('click', () => {
    if (progress.steps.length) runProgress();
  });

  initShowcase();
  registerReveals();
  loadAll();                         // sets loading states synchronously
  showView(viewFromHash());
  window.addEventListener('hashchange', () => showView(viewFromHash(), { focus: true }));
  $('#boot-notice')?.remove();
}

init();
