import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { ReactNode } from "react";
import {
  Image,
  ImageSourcePropType,
  Modal as RNModal,
  ModalProps as RNModalProps,
  TouchableOpacity,
  View,
} from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { Icon } from "react-native-paper";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "@/shared/theme";
import { Button } from "@/shared/ui";

import { Row } from "../row";
import { ScrollView } from "../scroll-view";

export interface ModalProps extends RNModalProps {
  confirmButton?: { content?: ReactNode; disabled?: boolean };
  hideFooter?: boolean;
  onConfirm?: VoidFunction;
  left?: ReactNode;
  right?: ReactNode;
  showHeader?: boolean;
  headerImage?: string | { uri: string } | ImageSourcePropType;
}

export const Modal = (props: ModalProps) => {
  const {
    children,
    confirmButton,
    hideFooter,
    onConfirm,
    onDismiss,
    visible,
    left = null,
    right = null,
    headerImage,
    style,
    ...rest
  } = props;

  const insets = useSafeAreaInsets();

  const { colors } = useTheme();

  const showHeader = Boolean(headerImage);

  const handleConfirm = () => {
    onConfirm?.();
  };

  return (
    <RNModal
      animationType="slide"
      presentationStyle="fullScreen"
      onDismiss={onDismiss}
      visible={visible}
      {...rest}
    >
      <GestureHandlerRootView style={{ flex: 1 }}>
        <BottomSheetModalProvider>
          <View
            style={{
              backgroundColor: colors.background,
              flex: 1,
              ...(!showHeader && { paddingTop: insets.top }),
            }}
          >
            {!showHeader && (
              <Row
                between
                centered
                style={
                  showHeader && {
                    position: "absolute",
                    top: insets.top,
                    left: 0,
                    right: 0,
                    width: "100%",
                    zIndex: 10,
                  }
                }
              >
                <TouchableOpacity onPress={onDismiss} style={{ right: 2 }}>
                  <Icon
                    color={colors.primary}
                    source="chevron-left"
                    size={40}
                  />
                </TouchableOpacity>
                {right && <View style={{ right: 24 }}>{right}</View>}
              </Row>
            )}
            <Row
              between
              centered
              wrap={false}
              style={{
                borderColor: colors.outline,
                justifyContent: "space-between",
                ...(!showHeader && { paddingTop: 8 }),
                paddingLeft: 1,
                paddingRight: 24,
              }}
            >
              <View style={{ flexShrink: 1, marginLeft: 16 }}>{left}</View>
            </Row>

            <ScrollView
              contentContainerStyle={{ paddingBottom: 12, flexGrow: 1 }}
            >
              <View style={{ backgroundColor: colors.background }}>
                {headerImage && (
                  <Image
                    source={
                      typeof headerImage === "string"
                        ? { uri: headerImage }
                        : headerImage
                    }
                    style={{ height: 360, width: "100%", top: 30 }}
                  />
                )}
              </View>
              <View
                style={[
                  style,
                  { backgroundColor: colors.background, flexGrow: 1 },
                ]}
              >
                {children}
              </View>
            </ScrollView>
            {!hideFooter && (
              <Row
                between
                style={{ paddingBottom: insets.bottom, paddingHorizontal: 20 }}
              >
                <Button
                  disabled={confirmButton?.disabled}
                  onPress={handleConfirm}
                  style={{ flex: 1 }}
                >
                  {confirmButton?.content ?? "Confirm"}
                </Button>
              </Row>
            )}
          </View>
        </BottomSheetModalProvider>
      </GestureHandlerRootView>
    </RNModal>
  );
};
