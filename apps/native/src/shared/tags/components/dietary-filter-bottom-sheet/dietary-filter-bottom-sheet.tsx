import { Ref } from "react";

import { useIngredientsFilterStore } from "@/features/ingredients";
import { useTags } from "@/shared/supabase";
import {
  FilterBottomSheet,
  FilterBottomSheetProps,
  FilterBottomSheetRef,
} from "@/shared/ui";

export interface DietaryFilterBottomSheetProps
  extends Pick<
    FilterBottomSheetProps,
    "disabled" | "children" | "singleSelect"
  > {
  onChange?: (value: string[]) => void;
  ref?: Ref<FilterBottomSheetRef>;
  value?: string[];
}

export const DietaryFilterBottomSheet = (
  props: DietaryFilterBottomSheetProps,
) => {
  const { disabled, onChange, ref, singleSelect, value, children } = props;

  const filterStore = useIngredientsFilterStore();
  const tags = useTags("dietary");

  const effectiveValue = value ?? filterStore.restrictions;
  const effectiveOnChange = onChange ?? ((v) => filterStore.setRestrictions(v));

  return (
    <FilterBottomSheet
      description="Let us know about your dietary preferences"
      disabled={disabled}
      options={tags.data?.map((item) => item.name) ?? []}
      onChange={effectiveOnChange}
      ref={ref}
      singleSelect={singleSelect}
      title="Dietary"
      value={effectiveValue}
    >
      {children}
    </FilterBottomSheet>
  );
};
