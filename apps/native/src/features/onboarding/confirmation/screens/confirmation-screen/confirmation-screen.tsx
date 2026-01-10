import { useRouter } from "expo-router";
import LottieView from "lottie-react-native";
import { useEffect } from "react";
import { Animated, View } from "react-native";

import { useUpdateProfile } from "@/core/supabase";
import { AuthLayout } from "@/features/auth";
import { useTheme } from "@/shared/theme";
import { Button } from "@/shared/ui";

export const ConfirmationScreen = () => {
  const { colors } = useTheme();

  const updateProfile = useUpdateProfile();

  const router = useRouter();

  const fadeAnim = new Animated.Value(0);

  const scaleAnim = new Animated.Value(0.7);

  const handleContinue = async () => {
    try {
      await updateProfile.mutateAsync({ onboarding_completed: true });
      router.push("/(tabs)");
    } catch (error) {
      console.error(error);
    }
  };

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
        delay: 600,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        useNativeDriver: true,
        friction: 5,
        delay: 600,
      }),
    ]).start();
  }, []);

  return (
    <AuthLayout
      button={<Button onPress={handleContinue}>Done</Button>}
      description="Enjoy using Fridgeezy"
    >
      <View
        style={{
          alignItems: "center",
          justifyContent: "center",
          marginTop: 120,
        }}
      >
        <LottieView
          autoPlay
          loop={true}
          source={require("@/core/assets/lottie/complete.json")}
          style={{ width: 240, height: 300 }}
        />
      </View>
    </AuthLayout>
  );
};
