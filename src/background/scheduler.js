import {
  ALARM_NAMES,
  LIVE_CAPTURE_DELAY_MS
} from "../shared/constants.js";

const MINIMUM_DURABLE_ALARM_MS = 30_000;

export function createStateScheduler(chromeApi, options = {}) {
  const now = options.now || (() => Date.now());
  const setTimer = options.setTimer || ((callback, delay) => setTimeout(callback, delay));
  const clearTimer = options.clearTimer || ((timer) => clearTimeout(timer));
  const onLiveCapture = options.onLiveCapture || (() => {});
  let liveTimer;

  function scheduleLiveCapture(delay = LIVE_CAPTURE_DELAY_MS) {
    if (liveTimer !== undefined) {
      clearTimer(liveTimer);
    }
    liveTimer = setTimer(() => {
      liveTimer = undefined;
      onLiveCapture();
    }, delay);
    chromeApi.alarms.create(ALARM_NAMES.LIVE_CAPTURE, {
      when: now() + Math.max(delay, MINIMUM_DURABLE_ALARM_MS)
    });
  }

  function scheduleStateChange() {
    scheduleLiveCapture();
  }

  return {
    scheduleLiveCapture,
    scheduleStateChange
  };
}
