import { useCallback, useEffect, useState } from "react";

import {
  useDeleteProfileDietaryPreference,
  useInsertProfileDietaryPreference,
  useProfileDietaryPreferences,
} from "@/core/supabase";

import { useTags } from "../use-tags";

export const useDietaryPreferencesEditor = () => {
  const tags = useTags("dietary");

  const query = useProfileDietaryPreferences();

  const insertMutation = useInsertProfileDietaryPreference();

  const deleteMutation = useDeleteProfileDietaryPreference();

  const isLoading = query.isLoading || tags.isLoading;

  const isMutating = insertMutation.isPending || deleteMutation.isPending;

  const initialState = query.data?.map((item) => item.tag_id) ?? [];

  const [selected, setSelected] = useState<string[]>(initialState);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const isSelected = prev.includes(id);
      return isSelected ? prev.filter((item) => item !== id) : [...prev, id];
    });
  }, []);

  const save = useCallback(async () => {
    const currentInitialState = query.data?.map((item) => item.tag_id) ?? [];

    // Find tags to add (in selected but not in initial)
    const toAdd = selected.filter((id) => !currentInitialState.includes(id));

    // Find tags to remove (in initial but not in selected)
    const toRemove = currentInitialState.filter((id) => !selected.includes(id));

    // Get the IDs of preferences to delete
    const idsToDelete =
      query.data
        ?.filter((pref) => toRemove.includes(pref.tag_id))
        .map((pref) => pref.id) ?? [];

    // Execute inserts and deletes in parallel
    await Promise.all([
      ...toAdd.map((tag_id) => insertMutation.mutateAsync({ tag_id })),
      ...(idsToDelete.length > 0
        ? [deleteMutation.mutateAsync(idsToDelete)]
        : []),
    ]);
  }, [selected, query.data, insertMutation, deleteMutation]);

  // Sync selected state when data loads
  useEffect(() => {
    if (!query.isLoading) {
      setSelected(initialState);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.isLoading]);

  return {
    isLoading,
    isMutating,
    selected,
    save,
    tags: tags.data,
    toggle,
  };
};
