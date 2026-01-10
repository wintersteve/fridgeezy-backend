import * as Linking from "expo-linking";

import { Button } from "@/shared/ui";

export const SubscriptionButton = () => {
  const openSubscriptions = async () => {
    const url = "https://apps.apple.com/account/subscriptions";

    const supported = await Linking.canOpenURL(url);

    if (supported) {
      await Linking.openURL(url);
    } else {
      console.warn("Can't open subscription management URL");
    }
  };

  return (
    <Button
      mode="text"
      size="sm"
      onPress={openSubscriptions}
      style={{ marginLeft: "auto" }}
    >
      Manage
    </Button>
  );
};
