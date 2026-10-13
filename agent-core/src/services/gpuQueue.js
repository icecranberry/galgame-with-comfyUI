// FIFO across image and speech work: later requests cannot starve either side.
export function createGpuQueue() {
  let tail = Promise.resolve();
  return function run(work) {
    const result = tail.then(work);
    tail = result.catch(() => {});
    return result;
  };
}
export const withGpu = createGpuQueue();
