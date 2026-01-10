import { useRef } from "react";

import { useFtsSearchRecipes } from "../use-fts-search-recipes";
import { useVectorSearchRecipes } from "../use-vector-search-recipes";

export const useSearchRecipes = () => {
  const fts = useFtsSearchRecipes();

  const vector = useVectorSearchRecipes();

  const abortRef = useRef<AbortController | null>(null);

  const isPending = fts.isPending || vector.isPending;

  const mutateAsync = async (payload: string) => {
    // Cancel any in-flight vector request
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    const ftsResponse = await fts.mutateAsync(payload);

    if (ftsResponse?.length) {
      return ftsResponse;
    }

    try {
      return await vector.mutateAsync({
        query: payload,
        signal: abortRef.current.signal,
      });
    } catch {}
  };

  return { isPending, mutateAsync };
};
