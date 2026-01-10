import { useState } from "react";
import { View } from "react-native";
import { Icon, Text } from "react-native-paper";

import { useTheme } from "@/shared/theme";
import { Modal, ModalProps } from "@/shared/ui";

import { SettingItem } from "../setting-item";

export type ProfileDeleteModalProps = ModalProps;

export const DeleteSetting = (props: ProfileDeleteModalProps) => {
  const { onDismiss } = props;

  const { colors } = useTheme();

  const handleConfirm = async () => {};

  const [visible, setVisible] = useState(false);

  const handlePress = () => {
    setVisible(true);
  };

  return (
    <>
      <SettingItem
        icon="account-remove"
        title="Delete Account"
        onPress={handlePress}
        destructive
      />
      <Modal visible={visible} onConfirm={handleConfirm} onDismiss={onDismiss}>
        <View
          style={{ alignItems: "center", justifyContent: "center", gap: 8 }}
        >
          <Icon color={colors.error} source="close-thick" size={120} />
          <View style={{ gap: 8, paddingHorizontal: 24 }}>
            <Text variant="headlineMedium">
              Are you sure you want to delete your account?
            </Text>
            <Text variant="bodySmall">
              This operation is irreversible. All your data will be lost
            </Text>
          </View>
        </View>
      </Modal>
    </>
  );
};
