import { BottomSheetModal } from "@gorhom/bottom-sheet";
import { useRef } from "react";
import { View } from "react-native";

import { RecipeTags, RecipeTagsProps } from "@/features/recipes";
import { useTheme } from "@/shared/theme";
import { BottomSheet, ChipProps } from "@/shared/ui";

export type TagsBottomSheetProps = Pick<ChipProps, "disabled"> &
  Pick<RecipeTagsProps, "data" | "style">;

export const TagsBottomSheet = (props: TagsBottomSheetProps) => {
  const { data, style } = props;

  const theme = useTheme();

  const ref = useRef<BottomSheetModal>(null);

  const handleExpand = () => {
    ref.current?.present();
  };

  return (
    <>
      <RecipeTags data={data} max={3} onExpand={handleExpand} style={style} />
      <BottomSheet ref={ref} snapPoints={["30%"]}>
        <View
          style={{
            flex: 1,
            paddingHorizontal: 20,
            paddingTop: 8,
          }}
        >
          <RecipeTags data={data} max={Infinity} style={style} />
        </View>
      </BottomSheet>
    </>
  );
};
