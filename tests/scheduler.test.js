import test from "node:test";
import assert from "node:assert/strict";
import { ALARM_NAMES } from "../src/shared/constants.js";
import { createStateScheduler } from "../src/background/scheduler.js";

test("普通状态变化只安排 2 秒实时捕获", () => {
  const alarmCalls = [];
  const timerCalls = [];
  let captured = 0;
  const scheduler = createStateScheduler(
    { alarms: { create: (...args) => alarmCalls.push(args) } },
    {
      now: () => 1_000_000,
      setTimer: (callback, delay) => { timerCalls.push({ callback, delay }); return timerCalls.length; },
      clearTimer: () => {},
      onLiveCapture: () => { captured += 1; }
    }
  );
  scheduler.scheduleStateChange();
  assert.equal(timerCalls[0].delay, 2_000);
  timerCalls[0].callback();
  assert.equal(captured, 1);
  assert.deepEqual(alarmCalls, [
    [ALARM_NAMES.LIVE_CAPTURE, { when: 1_030_000 }]
  ]);
});

test("窗口关闭不再安排自动快照归档", () => {
  const alarmCalls = [];
  const timerCalls = [];
  const scheduler = createStateScheduler(
    { alarms: { create: (...args) => alarmCalls.push(args) } },
    {
      now: () => 5000,
      setTimer: (callback, delay) => { timerCalls.push({ callback, delay }); return timerCalls.length; },
      clearTimer: () => {},
      onLiveCapture: () => {}
    }
  );
  scheduler.scheduleStateChange();
  assert.equal(timerCalls[0].delay, 2_000);
  assert.deepEqual(alarmCalls, [[ALARM_NAMES.LIVE_CAPTURE, { when: 35_000 }]]);
});
