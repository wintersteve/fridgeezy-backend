import { ViewStyle } from "react-native";

import { RecipeData } from "@/shared/supabase";
import { titleCase } from "@/shared/toolkit";
import { Chip, Row } from "@/shared/ui";

export interface RecipeTagsProps {
  data: RecipeData;
  max?: number;
  style?: ViewStyle;
  onExpand?: () => void;
}

export const RecipeTags = (props: RecipeTagsProps) => {
  const { data, max = 5, onExpand, style } = props;

  const tags = data.tags ?? [];

  return (
    <Row spacing={4} style={[{ flexGrow: 1 }, style]}>
      {tags?.slice(0, max).map((tag) => (
        <Chip readonly key={tag}>
          {titleCase(tag)}
        </Chip>
      ))}
      {tags.length > max && (
        <Chip readonly={!onExpand} onPress={onExpand}>
          +{tags.length - max}
        </Chip>
      )}
    </Row>
  );
};
