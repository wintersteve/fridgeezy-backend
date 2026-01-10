import { useFocusEffect } from "expo-router";
import { useCallback } from "react";

export const useBlurEffect = (callback: VoidFunction) => {
  useFocusEffect(
    useCallback(() => {
      return () => {
        callback();
      };
    }, []),
  );
};
