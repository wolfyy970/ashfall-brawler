export function createRenderScheduler({
  draw,
  active = () => false,
  fps = 60,
  requestFrame = (fn) => requestAnimationFrame(fn),
  cancelFrame = (id) => cancelAnimationFrame(id),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  now = () => performance.now(),
} = {}) {
  const interval = 1000 / fps;
  let visible = true,
    dirty = false,
    stopped = false,
    frame = 0,
    timer = 0,
    lastDraw = -Infinity;
  function cancel() {
    if (frame) cancelFrame(frame);
    if (timer) clearTimer(timer);
    frame = timer = 0;
  }
  function schedule() {
    if (stopped || !visible || frame || timer || (!dirty && !active())) return;
    const delay = Math.max(0, interval - (now() - lastDraw));
    if (delay > 1)
      timer = setTimer(() => {
        timer = 0;
        frame = requestFrame(tick);
      }, delay);
    else frame = requestFrame(tick);
  }
  function tick(ms) {
    frame = 0;
    if (stopped || !visible || (!dirty && !active())) return;
    dirty = false;
    lastDraw = ms;
    draw(ms);
    schedule();
  }
  return {
    invalidate() {
      dirty = true;
      schedule();
    },
    setVisible(value) {
      visible = value;
      cancel();
      lastDraw = -Infinity;
      if (visible) {
        dirty = true;
        schedule();
      }
    },
    stop() {
      stopped = true;
      dirty = false;
      cancel();
    },
    get pending() {
      return Boolean(frame || timer);
    },
  };
}
