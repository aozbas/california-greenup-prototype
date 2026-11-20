import { clamp } from './util.js';

const MONTH_STARTS = [1, 32, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// value of a {doy, v} series at a day of year, by linear interpolation
export function valueAtDoy(pts, doy) {
  if (!pts?.length) return NaN;
  if (doy <= pts[0].doy) return pts[0].v;
  if (doy >= pts[pts.length - 1].doy) return pts[pts.length - 1].v;
  let k = 0;
  while (pts[k + 1].doy < doy) k++;
  const t = (doy - pts[k].doy) / (pts[k + 1].doy - pts[k].doy);
  return pts[k].v * (1 - t) + pts[k + 1].v * t;
}

// The story's seasonal chart: day of year on x, greenness on y. Each call to show() describes the whole picture
// (curves, usual range, one highlighted year, notes, guesses) and the chart animates to it.
export function createStoryChart(host, { width = 640, height = 380, right = 118 } = {}) {
  const m = { t: 28, r: right, b: 30, l: 46 };
  const svg = d3.select(host).append('svg').attr('class', 'schart').attr('viewBox', `0 0 ${width} ${height}`)
    .attr('role', 'img').attr('aria-label', 'Greenness through the year');
  const x = d3.scaleLinear([1, 366], [m.l, width - m.r]);
  const y = d3.scaleLinear([0, 1], [height - m.b, m.t]);

  const gGrid = svg.append('g');
  MONTH_STARTS.forEach((d, i) => {
    gGrid.append('line').attr('class', 'gridline').attr('x1', x(d)).attr('x2', x(d)).attr('y1', m.t).attr('y2', height - m.b);
    gGrid.append('text').attr('class', 'tick').attr('x', x(d + 15)).attr('y', height - 10).attr('text-anchor', 'middle').text(MONTHS[i]);
  });
  const gY = svg.append('g').attr('transform', `translate(${m.l},0)`);
  svg.append('text').attr('class', 'axislabel').attr('x', 2).attr('y', 14).text('greenness (NDVI)');
  const gBand = svg.append('g');
  const gCurves = svg.append('g');
  const gYear = svg.append('g');
  const gGuess = svg.append('g');
  const cursor = svg.append('line').attr('class', 'cursor').attr('y1', m.t).attr('y2', height - m.b).style('opacity', 0);
  const gDots = svg.append('g');
  const gNotes = svg.append('g');

  const line = d3.line().x((d) => x(d.doy)).y((d) => y(d.v)).curve(d3.curveMonotoneX);
  const band = d3.area().x((d) => x(d.doy)).y0((d) => y(d.lo)).y1((d) => y(d.hi)).curve(d3.curveMonotoneX);
  let spec = { curves: [] };

  const api = {
    x, y, svg,
    show(next, { duration = 750 } = {}) {
      spec = { curves: [], ...next };
      const all = [];
      spec.curves.forEach((c) => { c.pts.forEach((p) => all.push(p.v)); (c.band || []).forEach((p) => all.push(p.lo, p.hi)); });
      (spec.year?.pts || []).forEach((p) => all.push(p.v));
      let [a, b] = spec.domain || d3.extent(all.filter(Number.isFinite));
      if (!spec.domain) {
        const pad = Math.max(0.02, (b - a) * 0.1);
        a = Math.max(0, a - pad); b = Math.min(1, b + pad);
        if (b - a < 0.2) { const c = (a + b) / 2; a = Math.max(0, c - 0.1); b = a + 0.2; }
      }
      y.domain([a, b]);
      const t = svg.transition().duration(duration).ease(d3.easeCubicInOut);

      gY.transition(t).call(d3.axisLeft(y).ticks(5).tickSize(-(width - m.l - m.r)).tickFormat(d3.format('.1f')))
        .call((g) => { g.select('.domain').remove(); g.selectAll('line').attr('class', 'gridline'); g.selectAll('text').attr('class', 'ytick'); });

      gBand.selectAll('path').data(spec.curves.filter((c) => c.band), (c) => c.key)
        .join((e) => e.append('path').attr('class', 'sband').style('opacity', 0).attr('d', (c) => band(c.band)))
        .attr('fill', (c) => c.color).attr('fill-opacity', 0.16)
        .transition(t).style('opacity', 1).attr('d', (c) => band(c.band));

      gCurves.selectAll('g.curve').data(spec.curves, (c) => c.key)
        .join(
          (e) => {
            const g = e.append('g').attr('class', 'curve').style('opacity', 0);
            g.append('path').attr('d', (c) => line(c.pts));
            g.append('text').attr('class', 'clabel');
            return g;
          },
          (u) => u,
          (x0) => x0.transition(t).style('opacity', 0).remove(),
        )
        .call((g) => g.transition(t).style('opacity', 1))
        .call((g) => g.select('path').attr('stroke', (c) => c.color).attr('stroke-width', (c) => c.width || 3)
          .attr('stroke-dasharray', (c) => c.dash || null).transition(t).attr('d', (c) => line(c.pts)))
        .call((g) => g.select('text').attr('fill', (c) => c.color).text((c) => c.label)
          .transition(t).attr('x', (c) => x(c.pts[c.pts.length - 1].doy) + 6).attr('y', (c) => y(c.pts[c.pts.length - 1].v) + 4));

      gYear.selectAll('path').data(spec.year ? [spec.year] : [], (d) => d.key)
        .join((e) => e.append('path').attr('class', 'syear').style('opacity', 0).attr('d', (d) => line(d.pts)),
          (u) => u, (x0) => x0.transition(t).style('opacity', 0).remove())
        .attr('stroke', (d) => d.color)
        .transition(t).style('opacity', 1).attr('d', (d) => line(d.pts));

      gGuess.selectAll('g').data(spec.guesses || [], (d) => d.key)
        .join((e) => {
          const g = e.append('g').attr('class', 'guess').style('opacity', 0);
          g.append('line').attr('y1', m.t).attr('y2', height - m.b);
          g.append('text').attr('text-anchor', 'start');
          return g;
        }, (u) => u, (x0) => x0.remove())
        .call((g) => g.select('line').attr('stroke', (d) => d.color).attr('x1', (d) => x(d.doy)).attr('x2', (d) => x(d.doy)))
        .call((g) => g.select('text').attr('fill', (d) => d.color).attr('x', (d) => x(d.doy) + 5)
          .attr('y', (d, i) => height - m.b - 8 - i * 17).text((d) => d.label))
        .transition(t).style('opacity', 1);

      gNotes.selectAll('g.note').data(spec.notes || [], (d) => d.key)
        .join((e) => {
          const g = e.append('g').attr('class', 'note').style('opacity', 0);
          g.append('line');
          g.append('circle').attr('r', 5);
          g.append('text');
          return g;
        }, (u) => u, (x0) => x0.transition(t).style('opacity', 0).remove())
        .call((g) => g.transition(t).delay(duration * 0.6).style('opacity', 1))
        .call((g) => g.select('circle').attr('fill', (d) => d.color).attr('cx', (d) => x(d.doy)).attr('cy', (d) => y(d.v)))
        .call((g) => g.select('line').attr('stroke', (d) => d.color)
          .attr('x1', (d) => x(d.doy)).attr('y1', (d) => y(d.v)).attr('x2', (d) => x(d.doy) + (d.dx ?? 0)).attr('y2', (d) => y(d.v) + (d.dy ?? -34)))
        .call((g) => g.select('text').attr('fill', (d) => d.color).attr('text-anchor', (d) => d.anchor || 'middle')
          .each(function (d) {
            // multi-line notes: stack lines away from the point, above it when the leader goes up
            const lines = d.text.split('\n'), dy = d.dy ?? -34, lh = 16;
            const tx = x(d.doy) + (d.dx ?? 0);
            const ty = dy < 0 ? y(d.v) + dy - 6 - (lines.length - 1) * lh : y(d.v) + dy + 14;
            d3.select(this).selectAll('tspan').data(lines).join('tspan').attr('x', tx).attr('y', (_, i) => ty + i * lh).text((l) => l);
          }));

      api.setCursor(spec.cursor ?? null);
    },
    // moves the date line and the dots on each curve without animating (used while scrolling through time)
    setCursor(doy) {
      if (doy == null) { cursor.style('opacity', 0); gDots.selectAll('*').remove(); return; }
      const d = clamp(doy, 1, 366);
      cursor.style('opacity', 1).attr('x1', x(d)).attr('x2', x(d));
      const pts = spec.curves.filter((c) => !c.noDot).map((c) => ({ key: c.key, color: c.color, v: valueAtDoy(c.pts, d) }))
        .filter((p) => Number.isFinite(p.v));
      gDots.selectAll('circle').data(pts, (p) => p.key).join('circle').attr('class', 'sdot').attr('r', 6)
        .attr('fill', (p) => p.color).attr('cx', x(d)).attr('cy', (p) => y(p.v));
    },
  };
  return api;
}
