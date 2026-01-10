import { ReactNode } from "react";
import { ModalProps as RNModalProps, StyleSheet, View } from "react-native";
import { IconButton } from "react-native-paper";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "@/shared/theme";
import { Row } from "@/shared/ui";

export interface CameraModalProps extends RNModalProps {
  top: ReactNode;
}

export const CameraModal = (props: CameraModalProps) => {
  const { children, onDismiss, top } = props;

  const insets = useSafeAreaInsets();

  const { colors } = useTheme();

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.black, paddingTop: insets.top + 18 },
      ]}
    >
      <Row centered style={styles.controls}>
        {top}
        <IconButton iconColor="white" icon="close-thick" onPress={onDismiss} />
      </Row>

      {children}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
  },
  controls: {
    alignSelf: "flex-end",
    marginBottom: 24,
    marginHorizontal: 8,
  },
});
