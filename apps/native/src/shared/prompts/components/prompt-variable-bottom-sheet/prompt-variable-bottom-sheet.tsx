import { forwardRef, ReactNode, useImperativeHandle, useRef } from "react";
import { View } from "react-native";

import {
  ComponentFilterBottomSheet,
  CourseFilterBottomSheet,
  CuisineFilterBottomSheet,
  DietaryFilterBottomSheet,
  PantryIngredientBottomSheet,
  PantryIngredientBottomSheetRef,
} from "@/shared/tags";
import { FilterBottomSheetRef } from "@/shared/ui";

export type TagType = "cuisine" | "dietary" | "course" | "component";
export type VariableType =
  | "ingredient"
  | "tag"
  | "component"
  | "course"
  | "type";

export interface PromptVariableBottomSheetRef {
  open: () => void;
  close: () => void;
}

export interface PromptVariableBottomSheetProps {
  children?: ReactNode;
  onSelect: (value: string) => void;
  tagType?: TagType | null;
  value?: string;
  variableType: VariableType;
}

export const PromptVariableBottomSheet = forwardRef<
  PromptVariableBottomSheetRef,
  PromptVariableBottomSheetProps
>((props, ref) => {
  const { children, onSelect, tagType, value, variableType } = props;

  const cuisineRef = useRef<FilterBottomSheetRef>(null);
  const dietaryRef = useRef<FilterBottomSheetRef>(null);
  const courseRef = useRef<FilterBottomSheetRef>(null);
  const componentRef = useRef<FilterBottomSheetRef>(null);
  const ingredientRef = useRef<PantryIngredientBottomSheetRef>(null);

  const handleOpen = () => {
    // Handle ingredient type
    if (variableType === "ingredient") {
      ingredientRef.current?.open();
      return;
    }

    // Handle tag type with tagType specifier
    if (variableType === "tag" && tagType) {
      switch (tagType) {
        case "cuisine":
          cuisineRef.current?.open();
          break;
        case "dietary":
          dietaryRef.current?.open();
          break;
        case "course":
          courseRef.current?.open();
          break;
        case "component":
          componentRef.current?.open();
          break;
      }
      return;
    }

    // Handle direct types (component, course)
    switch (variableType) {
      case "component":
        componentRef.current?.open();
        break;
      case "course":
        courseRef.current?.open();
        break;
    }
  };

  const handleClose = () => {
    cuisineRef.current?.close();
    dietaryRef.current?.close();
    courseRef.current?.close();
    componentRef.current?.close();
    ingredientRef.current?.close();
  };

  useImperativeHandle(ref, () => ({
    open: handleOpen,
    close: handleClose,
  }));

  const handleTagSelect = (values: string[]) => {
    if (values.length > 0) {
      onSelect(values[0]);
    }
  };

  const valueAsArray = value ? [value] : [];

  return (
    <View>
      {children}
      <CuisineFilterBottomSheet
        ref={cuisineRef}
        onChange={handleTagSelect}
        value={valueAsArray}
        singleSelect
      >
        {() => null}
      </CuisineFilterBottomSheet>
      <DietaryFilterBottomSheet
        ref={dietaryRef}
        onChange={handleTagSelect}
        value={valueAsArray}
        singleSelect
      >
        {() => null}
      </DietaryFilterBottomSheet>
      <CourseFilterBottomSheet
        ref={courseRef}
        onChange={handleTagSelect}
        value={valueAsArray}
        singleSelect
      >
        {() => null}
      </CourseFilterBottomSheet>
      <ComponentFilterBottomSheet
        ref={componentRef}
        onChange={handleTagSelect}
        value={valueAsArray}
        singleSelect
      >
        {() => null}
      </ComponentFilterBottomSheet>
      <PantryIngredientBottomSheet
        ref={ingredientRef}
        onChange={onSelect}
        value={value}
      >
        {() => null}
      </PantryIngredientBottomSheet>
    </View>
  );
});
