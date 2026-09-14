export const createTransitionQueue = (limit = 2) => {
  const pending = [];
  let active = 0;
  let timer;
  const pump = () => {
    clearTimeout(timer);
    for (let index = 0; index < pending.length;) {
      const job = pending[index];
      if (job.signal?.aborted) {
        pending.splice(index, 1);
        job.resolve(null);
      } else index++;
    }
    while (active < limit) {
      let index = -1;
      for (let candidate = 0; candidate < pending.length; candidate++) {
        if (pending[candidate].ready() &&
            (index < 0 || pending[candidate].priority > pending[index].priority)) index = candidate;
      }
      if (index < 0) break;
      const [job] = pending.splice(index, 1);
      active++;
      Promise.resolve().then(job.task).then(job.resolve, job.reject).finally(() => {
        active--;
        pump();
      });
    }
    if (pending.length) timer = setTimeout(pump, 50);
  };
  return (task, { ready = () => true, signal, priority = 0 } = {}) => new Promise((resolve, reject) => {
    pending.push({ task, ready, signal, priority, resolve, reject });
    pump();
  });
};
