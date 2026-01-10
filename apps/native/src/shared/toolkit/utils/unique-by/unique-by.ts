export const uniqueBy = <T, K>(array: T[], keyFn: (item: T) => K): T[] => {
  const values = new Set<K>();

  return array.filter((item) => {
    const key = keyFn(item);
    if (values.has(key)) return false;
    values.add(key);
    return true;
  });
};
