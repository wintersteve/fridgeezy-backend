import {
    Poppins_400Regular,
    Poppins_500Medium,
    Poppins_600SemiBold,
    Poppins_700Bold,
    Poppins_800ExtraBold,
} from "@expo-google-fonts/poppins";
import { useFonts } from "expo-font";
import * as QuickActions from "expo-quick-actions";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import "react-native-reanimated";
import { useEffect } from "react";
import { Platform, UIManager } from "react-native";

import { Providers } from "../src/core/config";
import {
    getDefaultStackOptions,
    getLargeTitleScreenOptions,
} from "../src/shared/navigation";
import { useTheme } from "../src/shared/theme";
import { ErrorBoundary as DefaultErrorBoundary } from "../src/shared/ui";

if (
    Platform.OS === "android" &&
    UIManager.setLayoutAnimationEnabledExperimental
) {
    UIManager.setLayoutAnimationEnabledExperimental(true);
}

export const ErrorBoundary = DefaultErrorBoundary;

// Prevent splash screen from auto-hiding
void SplashScreen.preventAutoHideAsync();

export default function Layout() {
    const [fontsLoaded, fontError] = useFonts({
        Poppins_400Regular,
        Poppins_500Medium,
        Poppins_600SemiBold,
        Poppins_700Bold,
        Poppins_800ExtraBold,
    });

    // Hide splash screen when fonts are loaded or if there's an error
    useEffect(() => {
        if (fontsLoaded || fontError) {
            void SplashScreen.hideAsync();
        }
    }, [fontsLoaded, fontError]);

    useEffect(() => {
        QuickActions.setItems([
            {
                id: "0",
                title: "Capture Image",
                icon: "heart",
                params: { href: "/camera" },
            },
        ]);
    }, []);

    // Keep splash visible while fonts load
    if (!fontsLoaded && !fontError) {
        return null;
    }

    return (
        <Providers>
            <RootNavigator />
        </Providers>
    );
}

function RootNavigator() {
    const { colors } = useTheme();

    return (
        <>
            <StatusBar style="dark" />
            <Stack screenOptions={getDefaultStackOptions(colors)}>
                <Stack.Screen name="+not-found" />
                <Stack.Screen
                    name="index"
                    options={{ animation: "none", gestureEnabled: false }}
                />
                <Stack.Screen
                    name="(auth)"
                    options={{ gestureEnabled: false }}
                />
                <Stack.Screen
                    name="(onboarding)"
                    options={{ gestureEnabled: false }}
                />
                <Stack.Screen name="(tabs)" options={{ animation: "none" }} />
                <Stack.Screen
                    name="camera"
                    options={{ animation: "fade", animationDuration: 200 }}
                />
                <Stack.Screen
                    name="ingredients"
                    options={getLargeTitleScreenOptions("Ingredients")}
                />
                <Stack.Screen name="recipes/generate" />
                <Stack.Screen
                    name="recipes/search"
                    options={getLargeTitleScreenOptions("Suggestions")}
                />
                <Stack.Screen name="recipes/[id]" />
                <Stack.Screen
                    name="collections"
                    options={{ presentation: "modal" }}
                />
                <Stack.Screen
                    name="prompts/[id]"
                    options={getLargeTitleScreenOptions("Run")}
                />
                <Stack.Screen
                    name="settings"
                    options={{ presentation: "modal" }}
                />
                <Stack.Screen name="welcome" options={{ animation: "none" }} />
            </Stack>
        </>
    );
}
