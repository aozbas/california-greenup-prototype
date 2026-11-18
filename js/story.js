import { dateToDay } from './util.js';

// 2009 is the year closest to usual across the state and the main regions (smallest typical gap, 2001-2025),
// so the first steps use it to stand in for "a normal year".
const TYPICAL = 2009;

// Each step sets the place, map layer and date when its card reaches the middle of the screen.
// Day-of-year values: Mar 13 = 72, Mar 21 = 80, Jul 20 = 201, Aug 15 = 227.
// Usual peaks in the data: Coast Range Mar 22, San Joaquin Valley Mar 14, Sierra Nevada Jul 20.
const STEPS = {
  hills:   { place: 'state', layer: 'green', day: dateToDay(TYPICAL, 80), speed: 64 },
  summer:  { place: 'state', layer: 'green', day: dateToDay(TYPICAL, 80), playTo: dateToDay(TYPICAL, 227), speed: 32 },
  sierra:  { place: 'sierra', layer: 'green', day: dateToDay(TYPICAL, 201) },
  green05: { place: 'state', layer: 'anom', day: dateToDay(2005, 72) },
  coast14: { place: 'coast_range', layer: 'anom', day: dateToDay(2014, 80) },
  sierra14:{ place: 'sierra', layer: 'anom', day: dateToDay(2014, 80) },
  explore: { place: 'state', layer: 'green', speed: 64 },
};

export const STORY_START = STEPS.hills.day;
export const STORY_YEARS = [TYPICAL, 2014, 2005];

export function initStory(ctl) {
  const steps = [...document.querySelectorAll('.story-step')];
  let current = null;
  const activate = (el) => {
    if (el === current) return;
    current = el;
    steps.forEach((s) => s.classList.toggle('active', s === el));
    const cfg = STEPS[el.dataset.step];
    if (cfg) ctl.goTo(cfg);
  };
  // a step is "on" while it crosses a thin band across the middle of the viewport
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) activate(e.target); });
  }, { rootMargin: '-45% 0px -45% 0px' });
  steps.forEach((s) => io.observe(s));

  // "replay" buttons inside a step re-run it (useful for the animated summer step)
  document.querySelectorAll('[data-replay]').forEach((b) => b.addEventListener('click', () => {
    const cfg = STEPS[b.dataset.replay];
    if (cfg) ctl.goTo(cfg);
  }));
}
