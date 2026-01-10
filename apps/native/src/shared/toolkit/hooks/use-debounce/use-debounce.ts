import { useRef, useCallback } from "react";

export const useDebounce = (delay: number = 300) => {
  const timeoutRef = useRef<number | null>(null);

  const debounce = useCallback(
    (fn: (...args: any[]) => void, ...args: any[]) => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        fn(...args);
      }, delay);
    },
    [delay],
  );

  const cancel = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  }, []);

  return { debounce, cancel };
};
