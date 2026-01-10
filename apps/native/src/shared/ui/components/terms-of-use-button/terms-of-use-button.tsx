import { Linking, TextStyle } from "react-native";
import { Text } from "react-native-paper";

export interface TermsOfUseButtonProps {
  style?: TextStyle;
}

export const TermsOfUseButton = (props: TermsOfUseButtonProps) => {
  const { style } = props;

  const handlePress = () => {
    Linking.openURL(
      "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/",
    );
  };

  return (
    <Text variant="labelMedium" onPress={handlePress} style={style}>
      Terms of Use
    </Text>
  );
};
