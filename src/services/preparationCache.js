// Share immutable assignment inputs between the grid and modal; bound retained memory.
export const createPreparationCache = (limit = 32) => {
  const entries = new Map();
  const get = (key, prepare) => {
    if (entries.has(key)) return entries.get(key);
    const result = Promise.resolve().then(prepare);
    entries.set(key, result);
    while (entries.size > limit) entries.delete(entries.keys().next().value);
    result.catch(() => {
      if (entries.get(key) === result) entries.delete(key);
    });
    return result;
  };
  get.peek = (key) => entries.get(key);
  return get;
};
