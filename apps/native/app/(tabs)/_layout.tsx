import * as Haptics from "expo-haptics";
import { useQuickActionRouting } from "expo-quick-actions/router";
import { Redirect, Tabs, useRouter } from "expo-router";
import {
    Platform,
    View,
    StyleSheet,
    Pressable,
    useWindowDimensions,
} from "react-native";
import { Icon, Text } from "react-native-paper";
import Animated, {
    useSharedValue,
    useAnimatedStyle,
    withSpring,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useProfile, useUser } from "../../src/core/supabase";
import { useTheme } from "../../src/shared/theme";
import { HapticTab } from "../../src/shared/ui";

const INDICATOR_WIDTH = 100;
const TAB_BAR_HEIGHT = 49; // iOS standard tab bar height

export default function Layout() {
    const { colors } = useTheme();
    const insets = useSafeAreaInsets();
    const tabBarHeight = TAB_BAR_HEIGHT + insets.bottom;

    const router = useRouter();

    const { width: screenWidth } = useWindowDimensions();

    // Auth hooks
    const user = useUser();
    const profile = useProfile();

    // Quick action routing
    useQuickActionRouting();

    // const customerInfo = useGetCustomerInfo();

    const indicatorPosition = useSharedValue(0);

    const animatedIndicatorStyle = useAnimatedStyle(() => ({
        transform: [{ translateX: indicatorPosition.value }],
    }));

    // Wait for auth validation
    if (user.isLoading || profile.isLoading) {
        return null;
    }

    // Redirect if not authenticated
    if (!user.data) {
        return <Redirect href="/welcome" />;
    }

    // Redirect if not subscribed
    // if (
    //   customerInfo.isFetched &&
    //   !customerInfo.data?.activeSubscriptions?.length
    // ) {
    //   return <Redirect href="/(onboarding)/subscription" />;
    // }

    // Redirect if onboarding not completed
    if (profile.data && !profile.data.onboarding_completed) {
        return <Redirect href="/(onboarding)/details" />;
    }

    const renderTabIcon = (iconName: string, color: string) => (
        <View style={[styles.iconWrapper]}>
            <Icon size={26} source={iconName} color={color} />
        </View>
    );

    return (
        <Tabs
            screenOptions={{
                headerShown: false,
                tabBarShowLabel: false,
                tabBarInactiveTintColor: colors.surfaceDisabled,
                tabBarActiveTintColor: colors.onSurface,
                sceneStyle: {
                    backgroundColor: colors.surface,
                    marginBottom: tabBarHeight,
                },
                tabBarButton: HapticTab,
                tabBarLabelStyle: Platform.select({
                    default: { fontFamily: "Poppins" },
                }),
                tabBarStyle: Platform.select({
                    default: {
                        position: "absolute",
                        borderTopWidth: 0,
                        backgroundColor: colors.surface,
                        paddingTop: 6,
                        shadowOpacity: 0.025,
                        shadowRadius: 4,
                        shadowOffset: { height: -8, width: 0 },
                    },
                }),
            }}
            tabBar={(props) => {
                const { state, descriptors, navigation } = props;

                // Calculate total tabs including the profile button
                const totalTabs = state.routes.length + 1; // +1 for profile
                const currentTabWidth = screenWidth / totalTabs;

                // Update indicator position when tab changes
                const targetPosition =
                    state.index * currentTabWidth +
                    (currentTabWidth - INDICATOR_WIDTH) / 2;

                indicatorPosition.value = withSpring(targetPosition, {
                    damping: 20,
                    stiffness: 200,
                });

                return (
                    <View
                        style={[
                            Platform.select({
                                default: {
                                    position: "absolute",
                                    bottom: 0,
                                    left: 0,
                                    right: 0,
                                    backgroundColor: colors.surface,
                                    height: tabBarHeight,
                                    paddingBottom: insets.bottom,
                                },
                            }),
                        ]}
                    >
                        {/* Animated top border indicator */}
                        <Animated.View
                            style={[
                                styles.indicator,
                                { backgroundColor: colors.primary },
                                animatedIndicatorStyle,
                            ]}
                        />

                        {/* Tab buttons container */}
                        <View style={styles.tabsContainer}>
                            {state.routes.map((route, index) => {
                                const { options } = descriptors[route.key];
                                const isFocused = state.index === index;

                                const onPress = () => {
                                    if (process.env.EXPO_OS === "ios") {
                                        Haptics.impactAsync(
                                            Haptics.ImpactFeedbackStyle.Light
                                        );
                                    }
                                    const event = navigation.emit({
                                        type: "tabPress",
                                        target: route.key,
                                        canPreventDefault: true,
                                    });

                                    if (!isFocused && !event.defaultPrevented) {
                                        navigation.navigate(route.name);
                                    }
                                };

                                const label =
                                    options.tabBarLabel ??
                                    options.title ??
                                    route.name;

                                return (
                                    <Pressable
                                        key={route.key}
                                        onPress={onPress}
                                        style={styles.tabButton}
                                    >
                                        {options.tabBarIcon?.({
                                            focused: isFocused,
                                            color: isFocused
                                                ? colors.primary
                                                : colors.surfaceDisabled,
                                            size: 26,
                                        })}
                                        <Text
                                            variant="titleSmall"
                                            style={[
                                                styles.tabLabel,
                                                {
                                                    color: isFocused
                                                        ? colors.primary
                                                        : colors.surfaceDisabled,
                                                },
                                            ]}
                                        >
                                            {typeof label === "string"
                                                ? label
                                                : route.name}
                                        </Text>
                                    </Pressable>
                                );
                            })}
                            <Pressable
                                onPress={() => {
                                    if (process.env.EXPO_OS === "ios") {
                                        Haptics.impactAsync(
                                            Haptics.ImpactFeedbackStyle.Light
                                        );
                                    }
                                    router.push("/settings");
                                }}
                                style={styles.tabButton}
                            >
                                <View style={[styles.iconWrapper]}>
                                    <Icon
                                        size={26}
                                        source="cog"
                                        color={colors.surfaceDisabled}
                                    />
                                </View>
                                <Text
                                    variant="labelSmall"
                                    style={[
                                        styles.tabLabel,
                                        { color: colors.surfaceDisabled },
                                    ]}
                                >
                                    Settings
                                </Text>
                            </Pressable>
                        </View>
                    </View>
                );
            }}
        >
            <Tabs.Screen
                name="index"
                options={{
                    animation: "shift",
                    tabBarLabel: "Explore",
                    tabBarIcon: ({ color }) => renderTabIcon("home", color),
                }}
            />
            <Tabs.Screen
                name="explore"
                options={{
                    animation: "shift",
                    tabBarLabel: "Pantry",
                    tabBarIcon: ({ color }) => renderTabIcon("basket", color),
                }}
            />
        </Tabs>
    );
}

const styles = StyleSheet.create({
    indicator: {
        position: "absolute",
        top: 0,
        width: INDICATOR_WIDTH,
        height: 3,
        borderBottomLeftRadius: 2,
        borderBottomRightRadius: 2,
    },
    tabsContainer: {
        flex: 1,
        flexDirection: "row",
        paddingTop: 6,
    },
    tabButton: {
        flex: 1,
        alignItems: "center",
    },
    iconWrapper: {
        width: 48,
        height: 28,
        borderRadius: 14,
        alignItems: "center",
        justifyContent: "center",
    },
    tabLabel: {
        fontSize: 11,
        marginTop: 2,
    },
});
