import { Icon, IconButton } from "react-native-paper";

import {
  useDeleteProfileRecipeInteraction,
  useInsertProfileRecipeInteraction,
  useProfileRecipeInteractions,
} from "@/core/supabase";
import { Recipe } from "@/shared/entities";
import { useTheme } from "@/shared/theme";
import { Button } from "@/shared/ui";

import { useCookedModalStore } from "../../hooks/use-cooked-modal-store";

export interface CookedButtonProps {
  compact?: boolean;
  data: Pick<Recipe, "id">;
  readonly?: boolean;
  size?: number;
}

export const CookedButton = (props: CookedButtonProps) => {
  const { compact = false, data, readonly, size } = props;

  const { colors } = useTheme();

  const cooked = useProfileRecipeInteractions("cooked");
  const insertInteraction = useInsertProfileRecipeInteraction();
  const deleteInteraction = useDeleteProfileRecipeInteraction();

  const cookedModalStore = useCookedModalStore();

  const isCooked = cooked.data?.some((c) => c.recipe_id === data.id);

  const handlePress = () => {
    if (isCooked) {
      deleteInteraction.mutate({
        recipe_id: data.id,
        interaction_type: "cooked",
      });
    } else {
      insertInteraction.mutate({
        recipe_id: data.id,
        interaction_type: "cooked",
      });
      cookedModalStore.toggle();
    }
  };

  if (readonly && size) {
    return (
      <Icon
        source="check-bold"
        size={size}
        color={isCooked ? colors.onSurface : colors.onSurfaceDisabled}
      />
    );
  }

  if (compact) {
    return (
      <IconButton
        disabled={readonly}
        selected={isCooked}
        icon={isCooked ? "check-bold" : "check-outline"}
        iconColor={colors.onBackground}
        onPress={handlePress}
        style={{ margin: 0 }}
      />
    );
  }

  return (
    <Button
      style={{ backgroundColor: colors.secondaryContainer }}
      textColor={colors.secondary}
      icon="check-bold"
      onPress={handlePress}
    >
      Cooked
    </Button>
  );
};
