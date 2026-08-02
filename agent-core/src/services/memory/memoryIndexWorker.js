export function createMemoryIndexWorker({
  concurrency = 2,
  claimJob,
  runJob,
  delayMs = 50,
  onError = () => {},
}) {
  let activeCount = 0;
  let scheduled = false;
  let running = false;
  let timer = null;

  function schedule(delay = 0) {
    if (!running || scheduled) return;
    scheduled = true;
    timer = setTimeout(pump, delay);
  }

  function pump() {
    scheduled = false;
    timer = null;
    if (!running) return;

    while (activeCount < concurrency) {
      let job;
      try {
        job = claimJob();
      } catch (error) {
        onError(error, null);
        schedule(delayMs);
        break;
      }
      if (!job) break;
      activeCount++;
      Promise.resolve()
        .then(() => runJob(job))
        .catch(error => onError(error, job))
        .finally(() => {
          activeCount--;
          schedule(delayMs);
        });
    }
  }

  return {
    start() {
      running = true;
      schedule();
    },
    wake() {
      schedule();
    },
    stop() {
      running = false;
      if (timer) clearTimeout(timer);
      timer = null;
      scheduled = false;
    },
    status() {
      return { running, activeCount, concurrency };
    },
  };
}
