import Constants from "expo-constants";
import { Text } from "react-native-paper";

import { Row } from "../row";

export const Brand = () => {
  return (
    <Row centered>
      <Text
        theme={{ fonts: { titleLarge: { fontSize: 40, lineHeight: 48 } } }}
        variant="titleLarge"
      >
        {Constants.expoConfig?.name}
      </Text>
    </Row>
  );
};
