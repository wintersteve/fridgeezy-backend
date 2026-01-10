import { Text } from "react-native-paper";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { usePrompts } from "@/core/supabase";
import { PromptFormatter } from "@/shared/prompts";
import { useTheme } from "@/shared/theme";
import { Fab as CustomFab, FabActionGroup } from "@/shared/ui";

const TAB_BAR_HEIGHT = 49;

export const Fab = () => {
  const theme = useTheme();
  const prompts = usePrompts();
  const insets = useSafeAreaInsets();

  const fabBottomOffset = TAB_BAR_HEIGHT + insets.bottom;

  const handleTakePicture = async () => {};

  const handleIngredientsPress = () => {};

  const handleSearchPress = () => {};

  const handlePromptPress = (promptId: string) => {
    // TODO: Handle prompt selection
    console.log("Selected prompt:", promptId);
  };

  const coreActions: FabActionGroup = {
    actions: [
      {
        icon: "camera",
        content: (
          <Text variant="labelMedium" style={{ color: theme.colors.onSurface }}>
            Take a Picture
          </Text>
        ),
        onPress: handleTakePicture,
      },
      {
        icon: "basket-plus",
        content: (
          <Text variant="labelMedium" style={{ color: theme.colors.onSurface }}>
            Select ingredients
          </Text>
        ),
        onPress: handleIngredientsPress,
      },
      {
        icon: "magnify",
        content: (
          <Text variant="labelMedium" style={{ color: theme.colors.onSurface }}>
            Search recipes
          </Text>
        ),
        onPress: handleSearchPress,
      },
    ],
  };

  const promptGroup: FabActionGroup = {
    actions:
      prompts.data?.map((prompt) => ({
        icon: "text-box-outline",
        content: <PromptFormatter value={prompt.prompt} variant="bodySmall" />,
        onPress: () => handlePromptPress(prompt.id),
      })) ?? [],
  };

  const groups =
    promptGroup.actions.length > 0 ? [promptGroup, coreActions] : [coreActions];

  return (
    <>
      <CustomFab
        groups={groups}
        icon="plus-thick"
        closeIcon="close-thick"
        position={{ bottom: fabBottomOffset, right: 16 }}
      />
    </>
  );
};
