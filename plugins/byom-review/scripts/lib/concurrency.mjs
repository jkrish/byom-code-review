export async function asyncPool(tasks, options = {}) {
  const concurrency = options.concurrency ?? 3;
  const stragglerTimeoutMs = options.stragglerTimeoutMs ?? 60000;
  const globalTimeoutMs = options.globalTimeoutMs ?? 300000;

  const results = new Map();
  const controllers = new Map();
  let hasSuccess = false;
  let stragglerTimer = null;
  let globalTimer = null;

  function abortPending(reason) {
    for (const [id, controller] of controllers) {
      if (!results.has(id)) {
        controller.abort(new Error(reason));
      }
    }
  }

  function armStragglerTimer() {
    if (stragglerTimer) clearTimeout(stragglerTimer);
    stragglerTimer = setTimeout(() => {
      abortPending("straggler timeout");
    }, stragglerTimeoutMs);
  }

  function onTaskComplete(id, result) {
    results.set(id, result);
    controllers.delete(id);

    if (result.status === "success") {
      hasSuccess = true;
    }

    const hasPending = tasks.some((t) => !results.has(t.id));
    if (hasSuccess && hasPending) {
      armStragglerTimer();
    }
  }

  function cleanup() {
    if (stragglerTimer) clearTimeout(stragglerTimer);
    if (globalTimer) clearTimeout(globalTimer);
  }

  async function executeTask(task) {
    const controller = new AbortController();
    controllers.set(task.id, controller);
    const start = Date.now();

    try {
      const value = await task.run(controller.signal);
      const result = {
        id: task.id,
        status: "success",
        value,
        error: null,
        durationMs: Date.now() - start
      };
      onTaskComplete(task.id, result);
    } catch (error) {
      const isAbort = error.name === "AbortError" || controller.signal.aborted;
      const result = {
        id: task.id,
        status: isAbort ? "timeout" : "error",
        value: null,
        error: error.message ?? String(error),
        durationMs: Date.now() - start
      };
      onTaskComplete(task.id, result);
    }
  }

  return new Promise((resolve) => {
    globalTimer = setTimeout(() => {
      abortPending("global timeout");
    }, globalTimeoutMs);

    let nextIndex = 0;
    let active = 0;

    function tryNext() {
      while (active < concurrency && nextIndex < tasks.length) {
        const task = tasks[nextIndex++];
        active++;
        executeTask(task).then(() => {
          active--;
          if (results.size === tasks.length) {
            cleanup();
            resolve(tasks.map((t) => results.get(t.id)));
          } else {
            tryNext();
          }
        });
      }
    }

    tryNext();
  });
}
