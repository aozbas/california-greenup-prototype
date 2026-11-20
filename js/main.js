import { loadCore } from './data.js';
import { createState, tip, fmtDay, dayToDate, dateToDay, fmt, signed, clamp } from './util.js';
import { createMap } from './map.js';
import { createSeasonal } from './seasonal.js';
import { createTimeline } from './timeline.js';
import { initStory } from './story.js';

const $ = (s) => document.querySelector(s);
const SHORT = {
  north_coast: 'North Coast', sacramento_valley: 'Sacramento Valley', sierra: 'Sierra Nevada',
  san_joaquin: 'San Joaquin Valley', coast_range: 'Coast Range', mojave: 'Mojave Desert',
};
const SCORE_LIM = 0.15;        // NDVI difference that fills a region tile's bar

async function main() {
  const bar = $('#progress-bar'), label = $('#progress-label');
  let data;
  try {
    data = await loadCore((f) => { bar.style.width = `${Math.round(f * 100)}%`; });
  } catch (err) {
    label.innerHTML = `Could not load the data: ${err.message}.<br>Serve this folder over http (for example <code>python -m http.server</code>) after running <code>python scripts/export_site.py</code>.`;
    throw err;
  }
  start(data);
  initStory(data);      // after the explorer, so the story's years load first
}

function start(data) {
  const state = createState({ day: data.dayMin, playing: false, speed: 64, layer: 'green', lasso: false });
  const obs = data.obs;
  const nYears = data.yearList.length;

  const mapHeight = clamp(window.innerHeight - 380, 380, 620);
  const map = createMap($('#map'), data, { height: mapHeight });
  const seasonal = createSeasonal($('#seasonal'), { width: 740, height: 310, onJump });
  const timeline = createTimeline($('#timeline'), data, { onSeek, onGrab });
  $('#app').hidden = false;
  $('#loading').hidden = true;

  let area = makeArea('state', 'All of California', null);
  let values = null, typical = null, baseYears = 0;
  function makeArea(key, label, idx) {
    let mask = null;
    if (idx) { mask = new Uint8Array(data.N); for (let j = 0; j < idx.length; j++) mask[idx[j]] = 1; }
    return { key, label, idx, mask };
  }
  const idxWhere = (pred) => { const out = []; for (let i = 0; i < data.N; i++) if (pred(i)) out.push(i); return Int32Array.from(out); };

  const regionsEl = $('#regions');
  const tiles = data.regions.map((r) => {
    const vals = Float32Array.from(data.series[r.key], (v) => (v == null ? NaN : v));
    const b = document.createElement('button');
    b.className = 'rtile'; b.dataset.key = r.key; b.title = `${r.name}: click to add or remove this region`;
    b.style.setProperty('--c', r.color);
    b.setAttribute('aria-pressed', 'false');
    b.innerHTML = `<span class="rname">${SHORT[r.key] || r.name}</span><span class="rbar"><i class="rfill"></i></span><span class="rval"></span>`;
    b.addEventListener('click', () => toggleRegion(r.key));
    regionsEl.appendChild(b);
    return { r, vals, typ: data.typicalOf(vals), el: b, fill: b.querySelector('.rfill'), val: b.querySelector('.rval') };
  });
  const tileOf = (key) => tiles.find((t) => t.r.key === key);
  const nameOf = (key) => SHORT[key] || tileOf(key).r.name;
  const listNames = (names) => (names.length < 3 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

  // regions picked from the tiles, in click order. Two or more means compare mode
  let selected = [];
  const regionIdx = {};
  const idxOfRegion = (key) => {
    if (!regionIdx[key]) { const id = tileOf(key).r.id; regionIdx[key] = idxWhere((i) => data.regionIds[i] === id); }
    return regionIdx[key];
  };
  function toggleRegion(key) {
    const fromTiles = area.key === 'multi' || !!tileOf(area.key);
    const base = fromTiles ? selected : [];
    showRegions(base.includes(key) ? base.filter((k) => k !== key) : [...base, key]);
  }
  function showRegions(keys) {
    map.setMark(null); map.gLasso.selectAll('*').remove();
    selected = keys;
    if (!keys.length) { setArea(makeArea('state', 'All of California', null)); return; }
    if (keys.length === 1) { setArea(makeArea(keys[0], tileOf(keys[0]).r.name, idxOfRegion(keys[0]))); return; }
    const parts = keys.map(idxOfRegion);
    const idx = new Int32Array(parts.reduce((s, p) => s + p.length, 0));
    let o = 0;
    for (const p of parts) { idx.set(p, o); o += p.length; }
    const a = makeArea('multi', listNames(keys.map(nameOf)), idx);
    a.keys = keys;
    setArea(a);
  }
  let compare = null;      // per-region series while comparing
  function updateTiles(loc, doy) {
    for (const t of tiles) {
      const d = data.valueAt(t.vals, loc) - data.usualAt(t.typ, doy);
      const w = Number.isFinite(d) ? Math.min(1, Math.abs(d) / SCORE_LIM) * 50 : 0;
      t.fill.style.width = `${w}%`;
      t.fill.style.left = d >= 0 ? '50%' : `${50 - w}%`;
      t.fill.style.background = d >= 0 ? '#2a9d8f' : '#b5651d';
      t.val.textContent = Number.isFinite(d) ? signed(d) : 'n/a';
      t.val.className = `rval ${d >= 0 ? 'up' : 'down'}`;
    }
  }

  function setArea(a) {
    area = a;
    if (a.key !== 'multi' && !tileOf(a.key)) selected = [];      // whole state, a spot or a drawn area
    tiles.forEach((t) => t.el.setAttribute('aria-pressed', String(selected.includes(t.r.key))));
    $('#tool-clear').setAttribute('aria-pressed', String(a.key === 'state'));
    refreshArea();
    updateHint();
    dirty = true;
  }

  function updateHint() {
    const s = state.get();
    const size = !area.idx ? '' : area.key === 'pixel' ? 'one 2 km cell' : `about ${Math.round(data.areaKm2(area.idx)).toLocaleString()} km²`;
    let t;
    if (s.lasso) t = area.key === 'lasso' ? `Your area (${size}) is shown. Drag on the map to draw a new one.` : 'Drag on the map to draw an area.';
    else if (area.key === 'multi') t = `Comparing ${area.label}. Click a highlighted region to remove it.`;
    else if (tileOf(area.key)) t = `${area.label} (${size}) is now shown in the chart and timeline. Click another region to compare the two.`;
    else t = area.idx ? `${area.label} (${size}) is now shown in the chart and timeline.` : 'Showing all of California. Click the map to pin a spot, or pick one or more regions above.';
    $('#area-hint').textContent = t;
  }

  const LINEKEY = $('#linekey').innerHTML;
  const anomLim = (anom) => {
    const abs = Array.from(anom).filter(Number.isFinite).map(Math.abs).sort(d3.ascending);
    return Math.max(0.03, abs.length ? d3.quantileSorted(abs, 0.98) : 0.05);
  };

  function refreshArea() {
    if (area.key === 'multi') {
      compare = area.keys.map((key) => {
        const t = tileOf(key);
        return { key, name: nameOf(key), color: t.r.color, vals: t.vals, typical: t.typ, lines: data.yearLines(t.vals), anom: data.anomalySeries(t.vals, t.typ) };
      });
      const lim = Math.max(...compare.map((c) => anomLim(c.anom)));      // one scale, so the strips can be compared
      timeline.setAnomalyRows(compare.map((c) => ({ name: c.name, color: c.color, values: c.anom, lim })));
      seasonal.setCompare(compare);
      values = null; typical = null; baseYears = data.baseTotal;
      $('#linekey').innerHTML = compare.map((c) => `<span><i class="k" style="border-color:${c.color}"></i>${c.name}</span>`).join('')
        + '<span><i class="k solid"></i>the year on the map</span><span><i class="k dashed"></i>usual year</span>';
      $('#chart-sub').textContent = `${area.label}. Solid lines are the year on the map, dashed lines are each region's usual year (median over 2001-2025). Each value is the median greenness of the region's 2 km cells.`;
      return;
    }
    compare = null;
    $('#linekey').innerHTML = LINEKEY;
    const r = data.areaSeries(area);
    values = r.values;
    baseYears = r.baseYears;
    typical = data.typicalOf(values);
    const anom = data.anomalySeries(values, typical);
    timeline.setAnomaly(anom, anomLim(anom));
    seasonal.setData(data.yearLines(values), typical);
    const usualTxt = baseYears < data.baseTotal
      ? `"Usual" will be the median over 2001-2025 at the same time of year once all years load (${baseYears} of ${data.baseTotal} so far).`
      : '"Usual" is the median over 2001-2025 at the same time of year.';
    $('#chart-sub').textContent = `${area.label}. Each line is one year of satellite observations (about every 8 days), showing the median greenness of the selected 2 km cells. ${usualTxt}`;
  }

  let dirty = true, share = NaN;
  function render() {
    const s = state.get();
    const loc = data.locate(s.day);
    let A = data.frame(loc.i), B = data.frame(loc.j);
    const ready = !!(A || B);
    $('#buffering').hidden = ready;
    timeline.setDay(s.day);
    const { y, doy } = dayToDate(s.day);
    seasonal.setNow(y, doy);
    $('#nowdate').textContent = fmtDay(s.day);
    if (!ready) {                     // map still loading: update the text anyway
      share = NaN;
      updateReadout(loc, y, doy);
      updateTiles(loc, doy);
      return;
    }
    let w = loc.w;
    if (!A) { A = B; w = 0; } else if (!B) { B = A; w = 0; }
    share = map.paintBlend({ A, B, w, mode: s.layer === 'anom' ? 'anom' : 'green', cA: data.climBase(loc.i), cB: data.climBase(loc.j), selMask: area.mask });
    updateReadout(loc, y, doy);
    updateTiles(loc, doy);
  }

  const verdictOf = (diff) => {
    if (!Number.isFinite(diff)) return '';
    if (Math.abs(diff) < 0.02) return '<b>About as green as usual.</b>';
    return `<b class="${diff > 0 ? 'up' : 'down'}">${diff > 0 ? 'Greener' : 'Browner'} than usual by ${fmt(Math.abs(diff))}.</b>`;
  };

  function updateReadout(loc, year, doy) {
    const s = state.get();
    const iN = Math.abs(s.day - obs.day[loc.i]) <= Math.abs(obs.day[loc.j] - s.day) ? loc.i : loc.j;
    const observed = Math.abs(s.day - obs.day[iN]) <= 0.75;
    const sat = obs.sensor[iN] === 'T' ? 'Terra' : 'Aqua';
    $('#badge').className = `badge ${observed ? 'obs' : ''}`;
    $('#badge').textContent = observed ? `Real observation (${sat})` : 'Between observations (blended)';
    const shareTxt = Number.isFinite(share) ? ` Across California, <b>${Math.round(share * 100)}%</b> of land is greener than usual.` : '';
    if (compare) {
      const rows = compare.map((c) => {
        const v = data.valueAt(c.vals, loc), u = data.usualAt(c.typical, doy);
        return `<p class="line cmp"><i class="cdot" style="background:${c.color}"></i><b>${c.name}</b>: greenness <b>${fmt(v)}</b>, usual <b>${fmt(u)}</b>. ${verdictOf(v - u)}</p>`;
      }).join('');
      $('#readout').innerHTML = `<div class="who">Comparing ${compare.length} regions</div>
        <p class="line">On <b>${fmtDay(s.day)}</b>:</p>${rows}<p class="line">${shareTxt.trim()}</p>`;
      return;
    }
    const v = data.valueAt(values, loc), u = data.usualAt(typical, doy), diff = v - u;
    const partial = baseYears < data.baseTotal;
    const verdict = partial
      ? `<span class="muted">Still loading years (${baseYears} of ${data.baseTotal}), so the usual value is not final yet.</span>`
      : verdictOf(diff);
    $('#readout').innerHTML = `<div class="who">${area.label}</div>
      <p class="line">On <b>${fmtDay(s.day)}</b>: greenness <b>${fmt(v)}</b>, usual for this time of year <b>${fmt(u)}</b>.</p>
      <p class="line">${verdict}${shareTxt}</p>`;
  }

  function updateLayerUI() {
    const l = state.get().layer;
    document.querySelectorAll('#layer-seg button').forEach((b) => b.classList.toggle('on', b.dataset.layer === l));
    if (l === 'green') {
      $('#legend').innerHTML = '<span>little vegetation</span><i class="ramp ndvi"></i><span>dense vegetation</span><span>(NDVI 0 to 0.9)</span>';
      $('#map-sub').textContent = 'Each 2 km cell is coloured by its greenness (NDVI), blended from the two satellite frames nearest the chosen date.';
    } else {
      $('#legend').innerHTML = '<span>browner than usual</span><i class="ramp anom"></i><span>greener than usual</span><span>(± 0.25 NDVI)</span>';
      $('#map-sub').textContent = 'Each 2 km cell is coloured by how far its greenness is from the usual value for this time of year (median of 2001-2025).';
    }
  }
  $('#layer-seg').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    state.set({ layer: b.dataset.layer });
    updateLayerUI(); dirty = true;
  });

  const playBtn = $('#play');
  function updatePlayUI() { playBtn.innerHTML = state.get().playing ? '&#10074;&#10074; Pause' : '&#9654; Play'; }
  function live() { $('#readout').setAttribute('aria-live', state.get().playing ? 'off' : 'polite'); }
  function play() { state.set({ playing: true }); updatePlayUI(); live(); }
  function pause() { state.set({ playing: false }); updatePlayUI(); live(); }
  playBtn.addEventListener('click', () => (state.get().playing ? pause() : play()));
  $('#speed').addEventListener('change', (e) => state.set({ speed: +e.target.value }));
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || ['SELECT', 'INPUT', 'TEXTAREA', 'BUTTON', 'SUMMARY'].includes(e.target.tagName)) return;
    e.preventDefault();
    state.get().playing ? pause() : play();
  });

  function seek(day) {
    state.set({ day: clamp(day, data.dayMin, data.dayMax) });
    data.prioritize(data.yearsNeeded(state.get().day));
    dirty = true;
  }
  let resumeAfter = false;
  function onSeek(day) { seek(day); }
  function onGrab() { resumeAfter = false; pause(); }
  function onJump(year, doy) { pause(); seek(dateToDay(year, doy)); }

  let lastT = performance.now(), priKey = '';
  function tick(now) {
    const dt = Math.min(0.1, (now - lastT) / 1000);
    lastT = now;
    const s = state.get();
    if (s.playing) {
      const ahead = Math.min(s.day + s.speed * 1.5 + 1, data.dayMax);
      const cur = data.yearsNeeded(s.day), need = [...new Set([...cur, ...data.yearsNeeded(ahead)])];
      const key = need.join(',');
      if (key !== priKey) { priKey = key; data.prioritize(need); }
      if (cur.some((y) => !data.isLoaded(y))) dirty = true;                         // pause until the current year has loaded
      else {
        let next = s.day + s.speed * dt;
        if (next >= data.dayMax) next = data.dayMin;
        state.set({ day: next });
        dirty = true;
      }
    }
    if (dirty) { dirty = false; render(); }
    requestAnimationFrame(tick);
  }

  let refreshTimer = 0;
  function updateLoadStatus() {
    const n = data.loadedCount();
    $('#loadstatus').textContent = n < nYears ? `Loading years: ${n} of ${nYears}` : '';
    timeline.setLoaded((y) => data.isLoaded(y));
  }
  data.onYearLoaded(() => {
    updateLoadStatus();
    dirty = true;
    if (area.key === 'pixel' || area.key === 'lasso') {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => { refreshArea(); dirty = true; }, 250);
    }
  });

  const svgEl = map.svg.node();
  let lassoPts = null, lassoShape = null, hoverRaf = 0;
  svgEl.addEventListener('pointermove', (evt) => {
    if (state.get().lasso) {
      if (!lassoPts) return;
      const p = map.svgPoint(evt), q = lassoPts[lassoPts.length - 1];
      if (Math.hypot(p[0] - q[0], p[1] - q[1]) > 1.2) { lassoPts.push(p); drawLasso(lassoPts); }
      return;
    }
    const i = map.cellAt(evt);
    cancelAnimationFrame(hoverRaf);
    if (i < 0) { tip.hide(); return; }
    hoverRaf = requestAnimationFrame(() => {
      const loc = data.locate(state.get().day);
      const { v, u } = data.pixelAt(i, loc);
      const d = v - u;
      tip.show(`<b>${fmt(data.lat(i), 2)}°N ${fmt(-data.lon(i), 2)}°W</b>
        <div>greenness <b>${fmt(v)}</b></div><div class="muted">usual here ${fmt(u)}${Number.isFinite(d) ? `, ${d >= 0 ? 'greener' : 'browner'} by ${fmt(Math.abs(d))}` : ''}</div>`, evt);
    });
  });
  svgEl.addEventListener('pointerleave', () => { cancelAnimationFrame(hoverRaf); tip.hide(); });
  svgEl.addEventListener('click', (evt) => {
    if (state.get().lasso) return;
    const i = map.cellAt(evt);
    if (i < 0) return;
    map.setMark(i);
    lassoShape = null; drawLasso(null);
    setArea(makeArea('pixel', `Spot at ${fmt(data.lat(i), 2)}°N ${fmt(-data.lon(i), 2)}°W`, Int32Array.of(i)));
  });
  svgEl.addEventListener('pointerdown', (evt) => {
    if (!state.get().lasso) return;
    // fails for synthetic events
    try { svgEl.setPointerCapture(evt.pointerId); } catch (e) {}
    resumeAfter = state.get().playing;
    if (resumeAfter) pause();
    lassoPts = [map.svgPoint(evt)];
    drawLasso(lassoPts);
  });
  svgEl.addEventListener('pointerup', () => {
    if (!state.get().lasso || !lassoPts) return;
    const pts = lassoPts;
    lassoPts = null;
    const idx = pts.length > 4 ? map.pixelsInPolygon(pts) : [];
    if (idx.length >= 3) {
      map.setMark(null);
      lassoShape = pts;
      setArea(makeArea('lasso', 'Your area', idx));
    }
    drawLasso(area.key === 'lasso' ? lassoShape : null);      // too small: keep showing the previous area
    if (resumeAfter) { resumeAfter = false; play(); }
  });
  function drawLasso(pts) {
    map.gLasso.selectAll('path').data(pts ? [pts] : []).join('path').attr('d', (p) => `M${p.map((q) => q.join(',')).join('L')}Z`);
  }

  $('#tool-lasso').addEventListener('click', () => {
    const on = !state.get().lasso;
    state.set({ lasso: on });
    $('#tool-lasso').setAttribute('aria-pressed', String(on));
    svgEl.style.cursor = on ? 'crosshair' : 'pointer';
    map.gLasso.selectAll('*').remove();
    tip.hide();
    updateHint();
  });
  $('#tool-clear').addEventListener('click', () => showRegions([]));

  state.on((keys) => { if (keys.includes('day') || keys.includes('layer')) dirty = true; });

  updateLayerUI(); updatePlayUI(); live(); updateLoadStatus(); setArea(area);
  data.prioritize([2000, 2001, 2002]);
  requestAnimationFrame(tick);
}

main();
