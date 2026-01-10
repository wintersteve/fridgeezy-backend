import "react-native-reanimated";
import { Stack } from "expo-router";

import { ExploreHeaderToggle } from "../../../src/shared/explore";
import { getBaseHeaderOptions } from "../../../src/shared/navigation";
import { useTheme } from "../../../src/shared/theme";

const COMMON_SCREEN_OPTIONS = {
    headerShown: true,
    headerLargeTitle: true,
    headerBackVisible: false,
};

export default function RootLayout() {
    const { colors } = useTheme();

    return (
        <Stack
            screenOptions={{
                animation: "fade",
                contentStyle: { backgroundColor: colors.background },
                ...getBaseHeaderOptions(colors),
            }}
        >
            <Stack.Screen
                name="pantry"
                options={{ ...COMMON_SCREEN_OPTIONS, headerTitle: "Pantry" }}
            />
            <Stack.Screen
                name="lists"
                options={{
                    ...COMMON_SCREEN_OPTIONS,
                    headerTitle: "Lists",
                    headerRight: () => <ExploreHeaderToggle />,
                }}
            />
            <Stack.Screen
                name="lists/[id]"
                options={{
                    headerTitle: "Shopping List",
                    headerBackVisible: true,
                    headerLargeTitle: false,
                }}
            />
        </Stack>
    );
}
