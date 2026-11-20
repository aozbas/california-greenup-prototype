import { dateToDay, dayToDate, fmtDay, fmt, signed, clamp, ACCENT, HILITE } from './util.js';
import { createMap } from './map.js';
import { createStoryChart, valueAtDoy } from './storychart.js';

// 2009 is the year closest to usual across the state and the main regions (smallest gap from the 2001-2025
// median), so it stands in for "a normal year".
const TYPICAL = 2009;
const MAR21 = 80, JUL20 = 201, AUG15 = 227;   // usual peaks: Coast Range Mar 22, San Joaquin Mar 14, Sierra Jul 20
const INK = '#1c2b22', BROWN = '#9a5200', TEAL = '#0f6b5f';
const COS = Math.cos((37.3 * Math.PI) / 180);
const MONTH_STARTS = [1, 32, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const $ = (s) => document.querySelector(s);

// where a label sits relative to its region's centre (map units, roughly px)
const LABEL_POS = {
  coast_range: { dx: -52, dy: 26, anchor: 'end' },
  san_joaquin: { dx: 46, dy: 40, anchor: 'start' },
  sierra: { dx: 60, dy: -26, anchor: 'start' },
  north_coast: { dx: -30, dy: 0, anchor: 'end' },
  sacramento_valley: { dx: 40, dy: -10, anchor: 'start' },
  mojave: { dx: 0, dy: -40, anchor: 'middle' },
};
const SHORT = { coast_range: 'Coast Range', san_joaquin: 'San Joaquin Valley', sierra: 'Sierra Nevada' };

export function whenInMonth(doy) {
  const d = new Date(Date.UTC(2001, 0, 1) + (Math.round(doy) - 1) * 86400000);
  const day = d.getUTCDate();
  return `${day <= 10 ? 'early' : day <= 20 ? 'mid' : 'late'} ${MONTH_NAMES[d.getUTCMonth()]}`;
}

export function initStory(data) {
  const regions = Object.fromEntries(data.regions.map((r) => [r.key, r]));

  // ---- per-region data: masks, label anchors, series, usual year ----
  const masks = {}, centre = {}, values = {}, typical = {}, lines = {};
  for (const r of data.regions) {
    const m = new Uint8Array(data.N);
    let sx = 0, sy = 0, n = 0;
    for (let i = 0; i < data.N; i++) {
      if (data.regionIds[i] !== r.id) continue;
      m[i] = 1; sx += (data.gx[i] + 0.5) * COS; sy += data.gy[i] + 0.5; n++;
    }
    masks[r.key] = m;
    centre[r.key] = [sx / n, sy / n];
  }
  for (const key of ['state', ...data.regions.map((r) => r.key)]) {
    values[key] = Float32Array.from(data.series[key], (v) => (v == null ? NaN : v));
    typical[key] = data.typicalOf(values[key]);
    lines[key] = data.yearLines(values[key]);
  }
  const union = (...keys) => {
    const m = new Uint8Array(data.N);
    keys.forEach((k) => { const a = masks[k]; for (let i = 0; i < data.N; i++) if (a[i]) m[i] = 1; });
    return m;
  };
  const usualPts = (key) => typical[key].pts.map((p) => ({ doy: p.x, v: p.v, lo: p.p25, hi: p.p75 }));
  const peakOf = (key) => usualPts(key).reduce((a, b) => (b.v > a.v ? b : a));
  const yearPts = (key, year) => (lines[key].get(year) || []).map((p) => ({ doy: p.doy, v: p.v }));
  const anomaly = (key, year, doy) => valueAtDoy(yearPts(key, year), doy) - data.usualAt(typical[key], doy);
  const color = (key) => regions[key]?.color || INK;

  const usualCurve = (key, { band = false, label = `${SHORT[key] || key}, usual`, c = color(key), width = 3 } = {}) => {
    const pts = usualPts(key);
    return { key: `u-${key}`, label, color: c, width, pts, band: band ? pts : null };
  };
  const peakNote = (key, dy = -40) => {
    const p = peakOf(key);
    return { key: `peak-${key}`, doy: p.doy, v: p.v, color: color(key), dy, text: `greenest:\n${whenInMonth(p.doy)}` };
  };
  // label offsets (px) put each note in the empty part of its chart: above the summer dip for the Coast Range,
  // under the summer plateau for the Sierra
  const NOTE_AT = { coast_range: { dx: 80, dy: -80 }, sierra: { dx: 150, dy: 50 } };
  const anomNote = (key, year, doy) => {
    const d = anomaly(key, year, doy), v = valueAtDoy(yearPts(key, year), doy), at = NOTE_AT[key] || { dx: 40, dy: -40 };
    return { key: `an-${key}-${year}`, doy, v, color: d < 0 ? BROWN : TEAL, dx: at.dx, dy: at.dy, anchor: 'start',
      text: `${fmtDay(dateToDay(year, doy), false)}, ${year}:\n${signed(d)} ${d < 0 ? 'browner' : 'greener'} than usual` };
  };

  // ---- the guess at the top ----
  initGuess(data, { usualCurve, peakOf, color });

  // ---- story graphics: two maps (the second only for the side-by-side step) and the chart ----
  const stage = $('#stage');
  const vw = window.innerWidth, vh = window.innerHeight, wide = vw > 1100;
  const railW = wide ? clamp(vw * 0.24, 280, 360) : 0;
  const stageW = Math.min(vw, 1560) - railW - 56 - 36;          // page padding and the gap after the rail
  const aspect = (data.W * COS) / data.H;
  // wide: rail beside the graphics; medium: map and chart side by side with the cards floating below; phone: stacked
  const mapH = Math.round(wide ? clamp(Math.min(vh - 150, (stageW - 28) / 2 / aspect), 320, 720)
    : vw > 760 ? clamp(Math.min(vh * 0.55, (vw - 28 - 28) / 2 / aspect), 260, 600)
      : clamp(Math.min(vh * 0.45, (vw - 28) / aspect), 220, 480));
  const mapA = createMap($('#smapA'), data, { height: mapH });
  const mapB = createMap($('#smapB'), data, { height: mapH });
  stage.style.setProperty('--map-w', `${Math.round(mapH * aspect)}px`);
  [mapA, mapB].forEach((mp) => mp.svg.style('cursor', 'default').attr('aria-hidden', 'true'));
  const notesA = mapA.svg.append('g').attr('class', 'mapnotes');
  const chart = createStoryChart($('#schart'), { width: 560, height: 390, right: 124 });

  const view = {
    A: { day: dateToDay(TYPICAL, MAR21), layer: 'green', mask: null },
    B: { day: dateToDay(2014, MAR21), layer: 'anom', mask: null },
  };
  let dirty = true, tween = null, active = null, scrub = null;

  function paint(map, v) {
    const loc = data.locate(v.day);
    let A = data.frame(loc.i), B = data.frame(loc.j), w = loc.w;
    if (!A && !B) return NaN;
    if (!A) { A = B; w = 0; } else if (!B) { B = A; w = 0; }
    return map.paintBlend({ A, B, w, mode: v.layer, cA: data.climBase(loc.i), cB: data.climBase(loc.j), selMask: v.mask });
  }
  function draw() {
    const shareA = paint(mapA, view.A);
    $('#smapA-date').textContent = fmtDay(view.A.day);
    const loading = !data.frame(data.locate(view.A.day).i);
    $('#smapA-load').hidden = !loading;
    if (stage.classList.contains('compare')) {
      const shareB = paint(mapB, view.B);
      $('#smapB-date').textContent = fmtDay(view.B.day);
      $('#smapA-cap').textContent = Number.isFinite(shareA) ? `${Math.round(shareA * 100)}% of land greener than usual` : '';
      $('#smapB-cap').textContent = Number.isFinite(shareB) ? `${Math.round(shareB * 100)}% of land greener than usual` : '';
    } else $('#smapA-cap').textContent = '';
  }
  function frame(now) {
    if (tween) {
      const t = clamp((now - tween.t0) / tween.dur, 0, 1), e = d3.easeCubicInOut(t);
      view.A.day = tween.from + (tween.to - tween.from) * e;
      chart.setCursor(dayToDate(view.A.day).doy);
      if (t >= 1) tween = null;
      dirty = true;
    }
    if (dirty) { dirty = false; draw(); }
    requestAnimationFrame(frame);
  }
  data.onYearLoaded(() => { dirty = true; });
  data.prioritize([TYPICAL, 2014, 2005]);

  function mapLabels(list) {
    const g = notesA.selectAll('g.rl').data(list, (d) => d.key).join(
      (e) => {
        const n = e.append('g').attr('class', 'rl').style('opacity', 0);
        n.append('line'); n.append('circle').attr('r', 3.5); n.append('text').attr('class', 'rl-name'); n.append('text').attr('class', 'rl-sub');
        return n;
      },
      (u) => u,
      (x) => x.transition().duration(300).style('opacity', 0).remove(),
    );
    g.each(function (d) {
      const [cx, cy] = centre[d.key], p = LABEL_POS[d.key] || { dx: 30, dy: 0, anchor: 'start' };
      const s = d3.select(this);
      s.select('circle').attr('cx', cx).attr('cy', cy);
      s.select('line').attr('x1', cx).attr('y1', cy).attr('x2', cx + p.dx * 0.85).attr('y2', cy + p.dy * 0.85);
      s.select('.rl-name').attr('x', cx + p.dx).attr('y', cy + p.dy).attr('text-anchor', p.anchor).text(d.name);
      s.select('.rl-sub').attr('x', cx + p.dx).attr('y', cy + p.dy + 17).attr('text-anchor', p.anchor).text(d.sub || '')
        .attr('class', `rl-sub ${d.tone || ''}`);
    });
    g.transition().duration(500).delay(250).style('opacity', 1);
  }
  const label = (key, sub, tone) => ({ key, name: SHORT[key] || regions[key].name, sub, tone });
  const signedLabel = (key, year, doy) => {
    const d = anomaly(key, year, doy);
    return label(key, `${signed(d)} vs usual`, d < 0 ? 'down' : 'up');
  };

  // ---- the steps ----
  const D = dateToDay;
  const STEPS = {
    hills: () => ({
      A: { day: D(TYPICAL, MAR21), layer: 'green', mask: union('coast_range', 'san_joaquin') },
      labels: [label('coast_range', 'greenest now'), label('san_joaquin', 'greenest now')],
      chart: { title: 'A usual year in the Coast Range', curves: [usualCurve('coast_range', { band: true })], notes: [peakNote('coast_range')], cursor: MAR21 },
    }),
    summer: () => ({
      A: { day: D(TYPICAL, MAR21), layer: 'green', mask: null },
      labels: [label('coast_range'), label('sierra')],
      chart: { title: 'A usual year: Coast Range and Sierra Nevada', curves: [usualCurve('coast_range'), usualCurve('sierra')], cursor: MAR21 },
      scrub: [D(TYPICAL, MAR21), D(TYPICAL, AUG15)],
    }),
    sierra: () => ({
      A: { day: D(TYPICAL, JUL20), layer: 'green', mask: masks.sierra },
      labels: [label('sierra', 'greenest now')],
      chart: { title: 'A usual year in the Sierra Nevada', curves: [usualCurve('sierra', { band: true })], notes: [peakNote('sierra')], cursor: JUL20 },
    }),
    compare: () => ({
      A: { day: D(2005, MAR21), layer: 'anom', mask: null },
      B: { day: D(2014, MAR21), layer: 'anom', mask: null },
      labels: [],
      chart: null,
    }),
    coast14: () => ({
      A: { day: D(2014, MAR21), layer: 'anom', mask: masks.coast_range },
      labels: [signedLabel('coast_range', 2014, MAR21)],
      chart: {
        title: 'Coast Range: 2014 against a usual year',
        curves: [usualCurve('coast_range', { band: true, c: INK, label: 'usual', width: 2.4 })],
        year: { key: 'y-coast-2014', color: HILITE, pts: yearPts('coast_range', 2014) },
        notes: [anomNote('coast_range', 2014, MAR21)], cursor: MAR21,
      },
    }),
    sierra14: () => ({
      A: { day: D(2014, MAR21), layer: 'anom', mask: masks.sierra },
      labels: [signedLabel('sierra', 2014, MAR21)],
      chart: {
        title: 'Sierra Nevada: 2014 against a usual year',
        curves: [usualCurve('sierra', { band: true, c: INK, label: 'usual', width: 2.4 })],
        year: { key: 'y-sierra-2014', color: ACCENT, pts: yearPts('sierra', 2014) },
        notes: [anomNote('sierra', 2014, MAR21)], cursor: MAR21,
      },
    }),
    takeaway: () => ({
      A: { day: D(2014, MAR21), layer: 'anom', mask: union('coast_range', 'sierra') },
      labels: [signedLabel('coast_range', 2014, MAR21), signedLabel('sierra', 2014, MAR21)],
      chart: {
        title: 'Spring 2014: same year, opposite results',
        curves: [usualCurve('coast_range', { c: color('coast_range'), label: 'Coast Range, usual', width: 2 }),
          usualCurve('sierra', { c: color('sierra'), label: 'Sierra, usual', width: 2 }),
          { key: 'y14-coast', label: '', color: color('coast_range'), width: 1.6, dash: '4 4', noDot: true, pts: yearPts('coast_range', 2014) },
          { key: 'y14-sierra', label: '', color: color('sierra'), width: 1.6, dash: '4 4', noDot: true, pts: yearPts('sierra', 2014) }],
        notes: [anomNote('coast_range', 2014, MAR21), anomNote('sierra', 2014, MAR21)], cursor: MAR21,
      },
    }),
  };

  function setLegend(layer) {
    $('#slegend').innerHTML = layer === 'green'
      ? '<span>little vegetation</span><i class="ramp ndvi"></i><span>dense vegetation</span>'
      : '<span>browner than usual</span><i class="ramp anom"></i><span>greener than usual</span>';
  }

  function apply(key) {
    const cfg = STEPS[key]?.();
    if (!cfg) return;
    const compare = !!cfg.B;
    stage.classList.toggle('compare', compare);
    const prev = { ...view.A };
    view.A.layer = cfg.A.layer; view.A.mask = cfg.A.mask;
    if (cfg.B) Object.assign(view.B, cfg.B);
    scrub = cfg.scrub || null;
    // move through time smoothly when staying on the same layer and within about a year, otherwise cut
    const target = scrub ? scrubDay() : cfg.A.day;
    if (!scrub && prev.layer === cfg.A.layer && Math.abs(target - prev.day) < 400 && Math.abs(target - prev.day) > 1) {
      tween = { from: prev.day, to: target, t0: performance.now(), dur: 900 };
    } else {
      tween = null; view.A.day = target;
      if (prev.layer !== cfg.A.layer) { const c = $('#smapA canvas'); c.classList.remove('flash'); void c.offsetWidth; c.classList.add('flash'); }
    }
    setLegend(cfg.A.layer);
    mapLabels(cfg.labels || []);
    if (cfg.chart) {
      $('#schart-title').textContent = cfg.chart.title;
      chart.show(cfg.chart);
      if (tween) chart.setCursor(dayToDate(prev.day).doy);
    }
    dirty = true;
  }

  // scroll position inside the "summer" step drives the date from March to August
  function scrubDay() {
    const el = document.querySelector('.story-step[data-step="summer"]');
    const r = el.getBoundingClientRect();
    const p = clamp((window.innerHeight * 0.5 - r.top) / Math.max(1, r.height - window.innerHeight * 0.3), 0, 1);
    $('#scrub-bar').style.width = `${Math.round(p * 100)}%`;
    return scrub[0] + (scrub[1] - scrub[0]) * p;
  }
  let scrollRaf = 0;
  window.addEventListener('scroll', () => {
    if (!scrub) return;
    cancelAnimationFrame(scrollRaf);
    scrollRaf = requestAnimationFrame(() => {
      tween = null;
      view.A.day = scrubDay();
      chart.setCursor(dayToDate(view.A.day).doy);
      dirty = true;
    });
  }, { passive: true });

  const steps = [...document.querySelectorAll('.story-step')];
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting || e.target === active) return;
      active = e.target;
      steps.forEach((s) => s.classList.toggle('active', s === active));
      apply(active.dataset.step);
    });
  }, { rootMargin: '-49% 0px -49% 0px' });
  steps.forEach((s) => io.observe(s));

  apply('hills');
  requestAnimationFrame(frame);
}

// ---- "when do you think it is greenest?" ----
function initGuess(data, { usualCurve, peakOf, color }) {
  const picks = {};
  const rows = d3.selectAll('.guess-row');
  rows.each(function () {
    const row = d3.select(this), key = this.dataset.key;
    row.select('.months').selectAll('button').data(MONTH_NAMES).join('button')
      .attr('type', 'button').attr('class', 'mbtn').attr('aria-pressed', 'false').attr('aria-label', (m) => m)
      .text((m) => m.slice(0, 3))
      .on('click', function (_, m) {
        picks[key] = MONTH_NAMES.indexOf(m);
        row.selectAll('.mbtn').attr('aria-pressed', (n) => String(n === m));
        $('#guess-reveal').disabled = Object.keys(picks).length < 2;
      });
  });
  let chart = null;
  $('#guess-reveal').addEventListener('click', () => {
    $('#guess-result').hidden = false;
    if (!chart) chart = createStoryChart($('#guess-chart'), { width: 640, height: 330, right: 150 });
    const keys = ['coast_range', 'sierra'];
    const guessDoy = (k) => MONTH_STARTS[picks[k]] + 14;
    const same = picks.coast_range === picks.sierra;
    const guesses = same
      ? [{ key: 'g-both', doy: guessDoy('coast_range'), label: 'your guess (both)', color: INK }]
      : keys.map((k) => ({ key: `g-${k}`, doy: guessDoy(k), label: `your guess: ${k === 'sierra' ? 'Sierra' : 'hills'}`, color: color(k) }));
    chart.show({
      curves: [usualCurve('coast_range', { label: 'Coastal hills' }), usualCurve('sierra', { label: 'Sierra Nevada' })],
      notes: keys.map((k) => { const p = peakOf(k); return { key: `pk-${k}`, doy: p.doy, v: p.v, color: color(k), dy: -30, text: whenInMonth(p.doy) }; }),
      guesses,
    });
    const verdict = (k, name) => {
      const p = peakOf(k), g = guessDoy(k);
      let diff = Math.abs(g - p.doy); diff = Math.min(diff, 365 - diff);
      const months = Math.round(diff / 30.4);
      const real = whenInMonth(p.doy);
      if (months === 0) return `<b>${name}:</b> you picked ${MONTH_NAMES[picks[k]]}. Spot on, they peak in ${real}.`;
      return `<b>${name}:</b> you picked ${MONTH_NAMES[picks[k]]}. They actually peak in ${real}, about ${months} month${months > 1 ? 's' : ''} ${g > p.doy ? 'earlier' : 'later'} than you guessed.`;
    };
    $('#guess-text').innerHTML = `${verdict('coast_range', 'The coastal hills')}<br>${verdict('sierra', 'The Sierra Nevada')}<br>
      The two places are greenest about ${Math.round((peakOf('sierra').doy - peakOf('coast_range').doy) / 30.4)} months apart. Scroll on to see how the green moves across the state.`;
  });
}
