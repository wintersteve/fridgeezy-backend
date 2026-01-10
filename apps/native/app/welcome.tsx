import { BottomSheetModal } from "@gorhom/bottom-sheet";
import * as AppleAuthentication from "expo-apple-authentication";
import { makeRedirectUri } from "expo-auth-session";
import { CodedError } from "expo-modules-core";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useRef, useState } from "react";
import {
    View,
    StyleSheet,
    TouchableOpacity,
    Image,
    Alert,
    Platform,
    ActivityIndicator,
} from "react-native";
import { Icon, Text } from "react-native-paper";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { supabase } from "../src/core/supabase";
import { useTheme } from "../src/shared/theme";
import {
    BottomSheet,
    Button,
    Card,
    PrivacyPolicyButton,
    Row,
    TermsOfUseButton,
} from "../src/shared/ui";

const BannerImage = require("@/core/assets/banner.png");
const DefaultImage = require("@/core/assets/images/icon.png");

const redirectUri = makeRedirectUri({
    scheme: "fridgeezy",
    path: "auth/callback",
});

export default function Screen() {
    const { colors } = useTheme();
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const bottomSheetModalRef = useRef<BottomSheetModal>(null);

    const [isAppleLoading, setIsAppleLoading] = useState(false);
    const [isGoogleLoading, setIsGoogleLoading] = useState(false);
    const [isFacebookLoading, setIsFacebookLoading] = useState(false);

    const isAnyLoading = isAppleLoading || isGoogleLoading || isFacebookLoading;

    const handleGetStarted = () => {
        bottomSheetModalRef.current?.present();
    };

    const handleLogin = () => {
        bottomSheetModalRef.current?.dismiss();
        router.push("/(auth)/login/email");
    };

    const handleApplePress = async () => {
        try {
            setIsAppleLoading(true);
            const credential = await AppleAuthentication.signInAsync({
                requestedScopes: [
                    AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
                    AppleAuthentication.AppleAuthenticationScope.EMAIL,
                ],
            });

            if (credential.identityToken) {
                await supabase.auth.signInWithIdToken({
                    provider: "apple",
                    token: credential.identityToken,
                });
            }
        } catch (error) {
            if ((error as CodedError)?.code === "ERR_REQUEST_CANCELED") {
                // User canceled - do nothing
            } else {
                Alert.alert(
                    "Sign in failed",
                    "Unable to sign in with Apple. Please try again."
                );
            }
        } finally {
            setIsAppleLoading(false);
        }
    };

    const handleOAuthPress = async (provider: "google" | "facebook") => {
        const setLoading =
            provider === "google" ? setIsGoogleLoading : setIsFacebookLoading;
        const providerName = provider === "google" ? "Google" : "Facebook";

        try {
            setLoading(true);

            const { data, error } = await supabase.auth.signInWithOAuth({
                provider,
                options: {
                    redirectTo: redirectUri,
                    skipBrowserRedirect: true,
                },
            });

            if (error) throw error;
            if (!data.url) throw new Error("No OAuth URL returned");

            const result = await WebBrowser.openAuthSessionAsync(
                data.url,
                redirectUri,
                { showInRecents: true }
            );

            if (result.type === "success") {
                // Parse tokens from the callback URL
                const params = new URL(result.url).hash.substring(1);
                const urlParams = new URLSearchParams(params);
                const accessToken = urlParams.get("access_token");
                const refreshToken = urlParams.get("refresh_token");

                if (accessToken && refreshToken) {
                    await supabase.auth.setSession({
                        access_token: accessToken,
                        refresh_token: refreshToken,
                    });
                }
            }
        } catch (error) {
            Alert.alert(
                "Sign in failed",
                `Unable to sign in with ${providerName}. Please try again.`
            );
        } finally {
            setLoading(false);
        }
    };

    return (
        <>
            <View style={styles.container}>
                {/* Banner Image */}
                <View style={styles.imageContainer}>
                    <Image
                        source={{
                            uri: Image.resolveAssetSource(BannerImage).uri,
                        }}
                        style={styles.bannerImage}
                        resizeMode="cover"
                    />
                </View>

                {/* Content Card */}
                <Card
                    style={[
                        styles.contentCard,
                        { flexGrow: 1, height: "100%" },
                    ]}
                    contentStyle={[
                        styles.cardContent,
                        { backgroundColor: colors.background },
                    ]}
                >
                    {/* Hero Section */}
                    <View
                        style={[
                            styles.heroSection,
                            { backgroundColor: colors.background },
                        ]}
                    >
                        <Image
                            source={{
                                uri: Image.resolveAssetSource(DefaultImage).uri,
                            }}
                            style={{
                                borderRadius: 8,
                                height: 40,
                                width: 40,
                                marginBottom: 8,
                            }}
                        />
                        <Text
                            style={{
                                color: colors.onSurface,
                                textAlign: "center",
                                marginHorizontal: 40,
                            }}
                            variant="headlineLarge"
                        >
                            Welcome to Fridgeezy
                        </Text>
                        <Text
                            variant="bodyLarge"
                            style={{
                                color: colors.onSurfaceVariant,
                                marginTop: 12,
                                textAlign: "center",
                                marginHorizontal: 24,
                            }}
                        >
                            Snap your ingredients, discover delicious recipes,
                            and say goodbye to food waste!
                        </Text>
                    </View>

                    {/* CTA Section */}

                    <View
                        style={[
                            styles.ctaSection,
                            { paddingBottom: insets.bottom + 24 },
                        ]}
                    >
                        <Button
                            onPress={handleGetStarted}
                            style={{ width: "100%" }}
                        >
                            Get Started
                        </Button>

                        <View style={styles.legalText}>
                            <Text
                                variant="labelSmall"
                                style={{
                                    color: colors.onBackgroundVariant,
                                    textAlign: "center",
                                }}
                            >
                                By continuing, you agree to our
                            </Text>
                            <Row centered spacing={4}>
                                <TermsOfUseButton />
                                <Text
                                    style={{
                                        color: colors.onBackgroundVariant,
                                    }}
                                    variant="labelSmall"
                                >
                                    and
                                </Text>
                                <PrivacyPolicyButton />
                            </Row>
                        </View>
                    </View>
                </Card>
            </View>

            <BottomSheet ref={bottomSheetModalRef} snapPoints={["50%"]}>
                <View style={styles.bottomSheetContent}>
                    <View style={styles.bottomSheetHeader}>
                        <Text
                            style={{ color: colors.onBackground }}
                            variant="titleLarge"
                        >
                            Create Account
                        </Text>
                        <Text
                            style={[
                                styles.bottomSheetSubtitle,
                                {
                                    color: colors.onSurfaceVariant,
                                    fontFamily: "Poppins",
                                },
                            ]}
                        >
                            Choose how you&apos;d like to get started
                        </Text>
                    </View>

                    {/* Social Login Buttons */}
                    <Row
                        centered
                        spacing={12}
                        style={{ justifyContent: "center" }}
                    >
                        {Platform.OS === "ios" && (
                            <TouchableOpacity
                                style={[
                                    styles.socialButton,
                                    { backgroundColor: colors.surfaceVariant },
                                ]}
                                onPress={handleApplePress}
                                disabled={isAnyLoading}
                            >
                                {isAppleLoading ? (
                                    <ActivityIndicator
                                        size="small"
                                        color={colors.onSurface}
                                    />
                                ) : (
                                    <Icon
                                        source="apple"
                                        size={24}
                                        color={colors.onSurface}
                                    />
                                )}
                            </TouchableOpacity>
                        )}
                        <TouchableOpacity
                            style={[
                                styles.socialButton,
                                { backgroundColor: colors.surfaceVariant },
                            ]}
                            onPress={() => handleOAuthPress("google")}
                            disabled={isAnyLoading}
                        >
                            {isGoogleLoading ? (
                                <ActivityIndicator
                                    size="small"
                                    color={colors.onSurface}
                                />
                            ) : (
                                <Icon
                                    source="google"
                                    size={24}
                                    color={colors.onSurface}
                                />
                            )}
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[
                                styles.socialButton,
                                { backgroundColor: colors.surfaceVariant },
                            ]}
                            onPress={() => handleOAuthPress("facebook")}
                            disabled={isAnyLoading}
                        >
                            {isFacebookLoading ? (
                                <ActivityIndicator
                                    size="small"
                                    color={colors.onSurface}
                                />
                            ) : (
                                <Icon
                                    source="facebook"
                                    size={24}
                                    color={colors.onSurface}
                                />
                            )}
                        </TouchableOpacity>
                    </Row>

                    {/* Divider */}
                    <Row centered spacing={20} style={{ marginHorizontal: 60 }}>
                        <View
                            style={[
                                styles.divider,
                                { backgroundColor: colors.outline },
                            ]}
                        />
                        <Text
                            style={{ color: colors.onBackgroundVariant }}
                            variant="labelSmall"
                        >
                            or
                        </Text>
                        <View
                            style={[
                                styles.divider,
                                { backgroundColor: colors.outline },
                            ]}
                        />
                    </Row>

                    <View style={styles.authButtons}>
                        <Button icon="email" onPress={handleLogin}>
                            Continue with Email
                        </Button>
                        <Button
                            mode="outlined"
                            icon="phone"
                            onPress={handleLogin}
                        >
                            Continue with Phone
                        </Button>
                    </View>
                </View>
            </BottomSheet>
        </>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    imageContainer: {
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: "54%",
    },
    bannerImage: {
        width: "100%",
        height: "100%",
    },
    contentCard: {
        position: "absolute",
        left: 0,
        right: 0,
        top: "52%",
    },
    cardContent: {
        flexGrow: 1,
    },
    heroSection: {
        alignItems: "center",
        paddingTop: 32,
        paddingHorizontal: 20,
    },
    logoContainer: {
        width: 96,
        height: 96,
        borderRadius: 28,
        alignItems: "center",
        justifyContent: "center",
        marginBottom: 24,
    },
    appName: {
        fontSize: 32,
        marginBottom: 8,
    },
    featuresSection: {
        paddingHorizontal: 32,
        gap: 20,
    },
    featureRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 16,
    },
    featureIcon: {
        width: 48,
        height: 48,
        borderRadius: 14,
        alignItems: "center",
        justifyContent: "center",
    },
    featureText: {
        flexGrow: 1,
    },
    featureTitle: {
        fontSize: 15,
        marginBottom: 2,
    },
    featureDescription: {
        fontSize: 13,
        lineHeight: 18,
    },
    ctaSection: {
        alignItems: "center",
        paddingHorizontal: 32,
        paddingTop: 20,
        gap: 16,
    },
    signInRow: {
        justifyContent: "center",
    },
    socialButton: {
        width: 56,
        height: 56,
        borderRadius: 16,
        alignItems: "center",
        justifyContent: "center",
    },
    divider: {
        flex: 1,
        height: 3,
    },
    bottomSheetContent: {
        flex: 1,
        padding: 24,
        gap: 20,
    },
    bottomSheetHeader: {
        alignItems: "center",
        gap: 4,
        marginBottom: 8,
    },
    bottomSheetTitle: {
        fontSize: 20,
    },
    bottomSheetSubtitle: {
        fontSize: 14,
        textAlign: "center",
    },
    authButtons: {
        gap: 12,
    },
    legalText: {
        alignItems: "center",
        gap: 4,
        marginTop: "auto",
        paddingBottom: 16,
    },
});
