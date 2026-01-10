import { Ref } from "react";

import { useIngredientsFilterStore } from "@/features/ingredients";
import { useTags } from "@/shared/supabase";
import {
  FilterBottomSheet,
  FilterBottomSheetProps,
  FilterBottomSheetRef,
} from "@/shared/ui";

export interface ComponentFilterBottomSheetProps
  extends Pick<
    FilterBottomSheetProps,
    "disabled" | "children" | "singleSelect"
  > {
  onChange?: (value: string[]) => void;
  ref?: Ref<FilterBottomSheetRef>;
  value?: string[];
}

export const ComponentFilterBottomSheet = (
  props: ComponentFilterBottomSheetProps,
) => {
  const { disabled, onChange, ref, singleSelect, value, children } = props;

  const filterStore = useIngredientsFilterStore();
  const tags = useTags("component");

  const effectiveValue =
    value ?? (filterStore.component ? [filterStore.component] : []);
  const effectiveOnChange =
    onChange ?? ((v) => filterStore.setComponent(v[0] ?? ""));

  return (
    <FilterBottomSheet
      description="Filter by dish component type"
      disabled={disabled}
      options={tags.data?.map((item) => item.name) ?? []}
      onChange={effectiveOnChange}
      ref={ref}
      singleSelect={singleSelect ?? true}
      title="Component"
      value={effectiveValue}
    >
      {children}
    </FilterBottomSheet>
  );
};
