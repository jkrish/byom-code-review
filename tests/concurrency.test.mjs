import test from "node:test";
import assert from "node:assert/strict";

import { asyncPool } from "../plugins/byom-review/scripts/lib/concurrency.mjs";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("asyncPool runs all tasks and returns results", async () => {
  const tasks = [
    { id: "a", run: async () => "result-a" },
    { id: "b", run: async () => "result-b" },
    { id: "c", run: async () => "result-c" }
  ];
  const results = await asyncPool(tasks, { concurrency: 2 });
  assert.equal(results.length, 3);
  assert.deepEqual(
    results.map((r) => r.id).sort(),
    ["a", "b", "c"]
  );
  for (const r of results) {
    assert.equal(r.status, "success");
    assert.equal(r.value, `result-${r.id}`);
    assert.equal(r.error, null);
    assert.ok(r.durationMs >= 0);
  }
});

test("asyncPool respects concurrency limit", async () => {
  let running = 0;
  let maxRunning = 0;

  const tasks = Array.from({ length: 6 }, (_, i) => ({
    id: `t${i}`,
    run: async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await delay(20);
      running--;
      return i;
    }
  }));

  await asyncPool(tasks, { concurrency: 3 });
  assert.ok(maxRunning <= 3, `max concurrent was ${maxRunning}, expected <= 3`);
});

test("asyncPool captures errors per-task without aborting others", async () => {
  const tasks = [
    { id: "ok", run: async () => "fine" },
    { id: "fail", run: async () => { throw new Error("boom"); } },
    { id: "ok2", run: async () => "also fine" }
  ];
  const results = await asyncPool(tasks, { concurrency: 3 });
  const ok = results.find((r) => r.id === "ok");
  const fail = results.find((r) => r.id === "fail");
  const ok2 = results.find((r) => r.id === "ok2");
  assert.equal(ok.status, "success");
  assert.equal(ok.value, "fine");
  assert.equal(fail.status, "error");
  assert.equal(fail.error, "boom");
  assert.equal(fail.value, null);
  assert.equal(ok2.status, "success");
});

test("asyncPool aborts stragglers after timeout", async () => {
  const tasks = [
    { id: "fast", run: async () => { await delay(10); return "done"; } },
    {
      id: "slow",
      run: async (signal) => {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, 5000);
          signal.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(signal.reason ?? new Error("aborted"));
          });
        });
        return "should not reach";
      }
    }
  ];
  const results = await asyncPool(tasks, { concurrency: 2, stragglerTimeoutMs: 50 });
  const fast = results.find((r) => r.id === "fast");
  const slow = results.find((r) => r.id === "slow");
  assert.equal(fast.status, "success");
  assert.equal(slow.status, "timeout");
});

test("asyncPool does not arm straggler timer until at least one success", async () => {
  const tasks = [
    { id: "err", run: async () => { throw new Error("fail"); } },
    {
      id: "slow",
      run: async () => {
        await delay(100);
        return "finished";
      }
    }
  ];
  const results = await asyncPool(tasks, { concurrency: 2, stragglerTimeoutMs: 30 });
  const slow = results.find((r) => r.id === "slow");
  assert.equal(slow.status, "success", "slow task should succeed because straggler timer only arms after a success");
});

test("asyncPool enforces global timeout", async () => {
  const tasks = [
    {
      id: "forever",
      run: async (signal) => {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, 10000);
          signal.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(signal.reason ?? new Error("aborted"));
          });
        });
        return "nope";
      }
    }
  ];
  const results = await asyncPool(tasks, { concurrency: 1, globalTimeoutMs: 50 });
  assert.equal(results[0].status, "timeout");
});
