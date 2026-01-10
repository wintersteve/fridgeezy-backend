import { Icon, IconButton } from "react-native-paper";

import {
  useDeleteProfileRecipeInteraction,
  useInsertProfileRecipeInteraction,
  useProfileRecipeInteractions,
} from "@/core/supabase";
import { Recipe } from "@/shared/entities";
import { useTheme } from "@/shared/theme";

export interface FavoriteButtonProps {
  data: Pick<Recipe, "id">;
  readonly?: boolean;
  size?: number;
}

export const FavoriteButton = (props: FavoriteButtonProps) => {
  const { data, readonly, size } = props;

  const { colors } = useTheme();

  const favorites = useProfileRecipeInteractions("favourite");

  const insertInteraction = useInsertProfileRecipeInteraction();

  const deleteInteraction = useDeleteProfileRecipeInteraction();

  const isFavorite = favorites.data?.some((f) => f.recipe_id === data?.id);

  const handlePress = () => {
    if (isFavorite) {
      deleteInteraction.mutate({
        recipe_id: data.id,
        interaction_type: "favourite",
      });
    } else {
      insertInteraction.mutate({
        recipe_id: data.id,
        interaction_type: "favourite",
      });
    }
  };

  if (readonly && size) {
    return (
      <Icon
        source="heart"
        size={size}
        color={isFavorite ? colors.primary : colors.onSurfaceDisabled}
      />
    );
  }

  return (
    <IconButton
      disabled={readonly}
      selected={isFavorite}
      icon={isFavorite ? "heart" : "heart-outline"}
      iconColor={isFavorite ? colors.primary : colors.onSurface}
      onPress={handlePress}
      style={{ margin: 0 }}
    />
  );
};
