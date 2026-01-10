import { Ref } from "react";

import { useIngredientsFilterStore } from "@/features/ingredients";
import { useTags } from "@/shared/supabase";
import {
  FilterBottomSheet,
  FilterBottomSheetProps,
  FilterBottomSheetRef,
} from "@/shared/ui";

export interface CourseFilterBottomSheetProps
  extends Pick<
    FilterBottomSheetProps,
    "disabled" | "children" | "singleSelect"
  > {
  onChange?: (value: string[]) => void;
  ref?: Ref<FilterBottomSheetRef>;
  value?: string[];
}

export const CourseFilterBottomSheet = (
  props: CourseFilterBottomSheetProps,
) => {
  const { disabled, onChange, ref, singleSelect, value, children } = props;

  const filterStore = useIngredientsFilterStore();
  const tags = useTags("course");

  const effectiveValue =
    value ?? (filterStore.course ? [filterStore.course] : []);
  const effectiveOnChange =
    onChange ?? ((v) => filterStore.setCourse(v[0] ?? ""));

  return (
    <FilterBottomSheet
      description="Filter by course type"
      disabled={disabled}
      options={tags.data?.map((item) => item.name) ?? []}
      onChange={effectiveOnChange}
      ref={ref}
      singleSelect={singleSelect ?? true}
      title="Course"
      value={effectiveValue}
    >
      {children}
    </FilterBottomSheet>
  );
};
