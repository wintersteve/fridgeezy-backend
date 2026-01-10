import "react-native-reanimated";
import { MenuView } from "@react-native-menu/menu";
import { usePathname, useRouter } from "expo-router";
import { Platform } from "react-native";
import { IconButton } from "react-native-paper";

import { useTheme } from "@/shared/theme";

export const ExploreHeaderToggle = () => {
  const router = useRouter();

  const pathname = usePathname();

  const { colors } = useTheme();

  return (
    <MenuView
      onPressAction={({ nativeEvent }) => {
        if (nativeEvent.event === "pantry") {
          router.navigate("/(tabs)/explore/pantry");
        }
        if (nativeEvent.event === "lists") {
          router.navigate("/(tabs)/explore/lists");
        }
      }}
      actions={[
        {
          id: "pantry",
          title: "Pantry",
          image: Platform.select({
            ios: "refrigerator",
            android: "ic_menu_gallery",
          }),
          attributes: { disabled: pathname === "/explore/pantry" },
        },
        {
          id: "lists",
          title: "Shopping Lists",
          image: Platform.select({
            ios: "cart",
            android: "ic_menu_agenda",
          }),
          attributes: { disabled: pathname === "/explore/lists" },
        },
      ]}
      shouldOpenOnLongPress={false}
    >
      <IconButton
        icon="chevron-down"
        size={24}
        iconColor={colors.onBackground}
        style={{ margin: 0 }}
      />
    </MenuView>
  );
};
