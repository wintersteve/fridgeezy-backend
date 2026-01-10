import { useRouter } from "expo-router";
import { ReactNode } from "react";
import { ScrollViewProps, StyleSheet, View, ViewStyle } from "react-native";
import { Icon, IconButton } from "react-native-paper";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "@/shared/theme";
import { Row } from "@/shared/ui";

import { ScrollView } from "../scroll-view";

export interface LayoutProps
  extends Pick<ScrollViewProps, "onScroll" | "contentInsetAdjustmentBehavior"> {
  bottom?: ReactNode;
  children: ReactNode;
  enableBack?: boolean;
  enableSafeArea?: boolean;
  enableTopInsets?: boolean;
  headerRight?: ReactNode;
  title?: ReactNode;
  titleStyle?: ViewStyle;
  spacing?: number;
  stickyHeader?: boolean;
  /**
   * Set to true to completely remove the header area.
   * @default false
   */
  hideHeader?: boolean;
}

export const Layout = (props: LayoutProps) => {
  const {
    bottom,
    children,
    enableBack = false,
    enableSafeArea = true,
    enableTopInsets = true,
    spacing = 16,
    stickyHeader = true,
    title,
    headerRight,
    hideHeader = false, // New prop to control header visibility
    onScroll,
    contentInsetAdjustmentBehavior,
  } = props;

  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const router = useRouter();

  const handleBackPress = () => {
    router.back();
  };

  // Header content (back button and title) is defined separately
  // so it can be placed in either the sticky container or the scroll view.
  const headerContent = (
    <View style={styles.headerContentContainer}>
      <Row between centered>
        {enableBack && (
          <IconButton
            icon={() => (
              <View>
                <Icon source="chevron-left" size={24} />
              </View>
            )}
            mode="contained"
            onPress={handleBackPress}
            style={styles.back}
          />
        )}
        {headerRight && headerRight}
      </Row>
      {title && <View style={{ paddingBottom: 8 }}>{title}</View>}
    </View>
  );

  const headerContainer = (
    <View
      style={[
        styles.headerContainer,
        {
          paddingBottom: title ? 4 : 2,
          backgroundColor: colors.surface,
          paddingTop: enableTopInsets ? insets.top : 0,
        },
      ]}
    >
      {/* If the header is sticky, its content is placed inside this container */}
      {stickyHeader && headerContent}
    </View>
  );

  return (
    <View
      style={[
        styles.safeArea,
        { backgroundColor: colors.surface },
        // Apply safe area padding directly if the header is hidden
        enableSafeArea && hideHeader ? { paddingTop: insets.top } : {},
      ]}
    >
      {/* The header container is only rendered if hideHeader is false */}
      {!hideHeader && headerContainer}

      <View style={styles.container}>
        <ScrollView
          contentInsetAdjustmentBehavior={contentInsetAdjustmentBehavior}
          contentContainerStyle={[
            styles.scrollContent,
            { backgroundColor: colors.background, marginHorizontal: spacing },
          ]}
          style={styles.scrollView}
          scrollEventThrottle={16}
          onScroll={onScroll}
          keyboardShouldPersistTaps="always"
        >
          {!hideHeader && !stickyHeader && headerContent}
          {children}
        </ScrollView>
      </View>
      {bottom && (
        <View
          style={[
            styles.bottom,
            {
              backgroundColor: colors.background,
              paddingBottom: insets.bottom + 16,
            },
          ]}
        >
          {bottom}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  container: { flex: 1 },
  scrollView: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  headerContainer: { zIndex: 10 },
  headerContentContainer: { paddingHorizontal: 16 },
  back: { alignSelf: "flex-start", left: -6 },
  bottom: {
    paddingTop: 16,
    elevation: 8,
    shadowOpacity: 0.05,
    shadowRadius: 4,
    paddingHorizontal: 16,
  },
});
