import assert from 'node:assert/strict';
import test from 'node:test';
import { createRenderScheduler } from './render-scheduler.mjs';
function harness(active = () => false) {
  let t = 0,
    id = 0,
    draws = 0;
  const frames = new Map(),
    timers = new Map();
  const scheduler = createRenderScheduler({
    draw: () => draws++,
    active,
    fps: 30,
    now: () => t,
    requestFrame: (fn) => {
      frames.set(++id, fn);
      return id;
    },
    cancelFrame: (i) => frames.delete(i),
    setTimer: (fn) => {
      timers.set(++id, fn);
      return id;
    },
    clearTimer: (i) => timers.delete(i),
  });
  return {
    scheduler,
    get draws() {
      return draws;
    },
    step(ms = 34) {
      t += ms;
      for (const [i, fn] of [...timers]) {
        timers.delete(i);
        fn();
      }
      for (const [i, fn] of [...frames]) {
        frames.delete(i);
        fn(t);
      }
    },
  };
}
test('idle has no pending work after one invalidated draw', () => {
  const h = harness();
  assert.equal(h.scheduler.pending, false);
  h.scheduler.invalidate();
  h.step();
  assert.equal(h.draws, 1);
  assert.equal(h.scheduler.pending, false);
});
test('hidden cancels work and visible redraws once', () => {
  const h = harness();
  h.scheduler.invalidate();
  h.scheduler.setVisible(false);
  h.step();
  assert.equal(h.draws, 0);
  h.scheduler.setVisible(true);
  h.step();
  assert.equal(h.draws, 1);
});
test('active continues then sleeps without idle callbacks', () => {
  let active = true;
  const h = harness(() => active);
  h.scheduler.invalidate();
  h.step();
  h.step();
  assert.equal(h.draws, 2);
  active = false;
  h.step();
  assert.equal(h.draws, 2);
  assert.equal(h.scheduler.pending, false);
});
