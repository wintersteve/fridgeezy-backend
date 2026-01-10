export const parse = async <T>(raw: string, defaultValue: T) => {
  return raw ? JSON.parse(raw) : defaultValue;
};
