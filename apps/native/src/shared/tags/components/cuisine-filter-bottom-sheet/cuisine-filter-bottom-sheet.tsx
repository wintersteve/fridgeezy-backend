import { Ref } from "react";

import { useIngredientsFilterStore } from "@/features/ingredients";
import { useTags } from "@/shared/supabase";
import {
  FilterBottomSheet,
  FilterBottomSheetProps,
  FilterBottomSheetRef,
} from "@/shared/ui";

export interface CuisineFilterBottomSheetProps
  extends Pick<
    FilterBottomSheetProps,
    "disabled" | "children" | "singleSelect"
  > {
  onChange?: (value: string[]) => void;
  ref?: Ref<FilterBottomSheetRef>;
  value?: string[];
}

export const CuisineFilterBottomSheet = (
  props: CuisineFilterBottomSheetProps,
) => {
  const { disabled, onChange, ref, singleSelect, value, children } = props;

  const filterStore = useIngredientsFilterStore();
  const tags = useTags("cuisine");

  const effectiveValue =
    value ?? (filterStore.cuisine ? [filterStore.cuisine] : []);
  const effectiveOnChange =
    onChange ?? ((v) => filterStore.setCuisine(v[0] ?? ""));

  return (
    <FilterBottomSheet
      description="Select your favourite cuisines"
      disabled={disabled}
      options={tags.data?.map((item) => item.name) ?? []}
      onChange={effectiveOnChange}
      ref={ref}
      singleSelect={singleSelect ?? true}
      title="Cuisines"
      value={effectiveValue}
    >
      {children}
    </FilterBottomSheet>
  );
};
