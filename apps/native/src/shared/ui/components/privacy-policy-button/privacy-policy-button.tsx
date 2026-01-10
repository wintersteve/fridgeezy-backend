import { Linking, TextStyle } from "react-native";
import { Text } from "react-native-paper";

export interface PrivacyPolicyButtonProps {
  style?: TextStyle;
}

export const PrivacyPolicyButton = (props: PrivacyPolicyButtonProps) => {
  const { style } = props;

  const handlePress = async () => {
    await Linking.openURL(
      "https://chisel-specialist-61b.notion.site/Privacy-Policy-252ce84a1d9c80258344cfd06194ef61",
    );
  };

  return (
    <Text variant="labelMedium" onPress={handlePress} style={style}>
      Privacy Policy
    </Text>
  );
};
