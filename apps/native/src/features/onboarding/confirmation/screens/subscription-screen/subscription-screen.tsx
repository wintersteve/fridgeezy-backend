import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { Text } from "react-native-paper";

import { useGetOfferings, usePurchaseOffering } from "@/core/revenuecat";
import { useUpdateProfile } from "@/core/supabase";
import { AuthLayout } from "@/features/auth";
import { useTheme } from "@/shared/theme";
import {
  PrivacyPolicyButton,
  TermsOfUseButton,
  Button,
  Row,
  Timeline,
  Tabs,
} from "@/shared/ui";

export const SubscriptionScreen = () => {
  const { colors } = useTheme();

  const updateProfile = useUpdateProfile();

  const router = useRouter();

  const offerings = useGetOfferings();

  const purchase = usePurchaseOffering();

  const packages = offerings.data?.all.default.availablePackages ?? [];

  const [offeringId, setOfferingId] = useState<string>(
    packages[0]?.packageType,
  );

  const offering = packages.find(
    (offering) => offering.packageType === offeringId,
  );

  const handleChange = (id: string) => {
    setOfferingId(id);
  };

  const handleContinue = async () => {
    // if (offering) {
    //   await purchase.mutateAsync(offering);
    //   router.replace("/(onboarding)/confirmation");
    // }
    try {
      await updateProfile.mutateAsync({ onboarding_completed: true });
      router.push("/(tabs)");
    } catch (error) {
      console.error(error);
    }
  };

  useEffect(() => {
    if (!offeringId) {
      setOfferingId(packages[0]?.packageType);
    }
  }, [packages]);

  return (
    <AuthLayout
      button={<Button onPress={handleContinue}>Start free trial</Button>}
      description={
        <Row centered>
          <Text
            variant="bodyMedium"
            style={{ color: colors.onSurfaceVariant, marginRight: 4 }}
          >
            First 14 days free, then
          </Text>
          <Text style={{ color: colors.onSurfaceVariant }} variant="bodyMedium">
            ${offering?.product.pricePerMonth}
          </Text>
          <Text style={{ color: colors.onSurfaceVariant }} variant="bodyMedium">
            /month
          </Text>
          <Text
            style={{
              color: colors.onSurfaceVariant,
              marginLeft: 4,
            }}
            variant="bodyMedium"
          >
            (${offering?.product.pricePerYear?.toFixed(2)}/year)
          </Text>
        </Row>
      }
    >
      <View style={{ justifyContent: "center", gap: 24 }}>
        <Tabs
          id={offeringId}
          items={packages?.map((p) => ({ id: p.packageType }))}
          onChange={handleChange}
        />
      </View>
      <View style={{ marginHorizontal: 8, marginTop: 40 }}>
        <Timeline />
      </View>
      <Row spacing={12} style={{ alignSelf: "center", marginTop: 24 }}>
        <TermsOfUseButton
          style={{
            borderColor: colors.onSurfaceDisabled,
            borderRightWidth: 2,
            paddingRight: 12,
          }}
        />
        <PrivacyPolicyButton />
      </Row>
    </AuthLayout>
  );
};
