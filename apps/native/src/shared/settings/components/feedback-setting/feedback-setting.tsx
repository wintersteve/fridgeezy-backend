import { Linking } from "react-native";

import { SettingItem } from "../setting-item";

export const FeedbackSetting = () => {
  const handlePress = async () => {
    await Linking.openURL(
      "https://apps.apple.com/app/idYOUR_APP_ID?action=write-review",
    );
  };

  return (
    <SettingItem icon="message-text" title="Feedback" onPress={handlePress} />
  );
};
