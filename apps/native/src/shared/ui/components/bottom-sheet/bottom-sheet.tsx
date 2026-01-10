import {
  BottomSheetModal,
  BottomSheetBackdrop,
  BottomSheetProps as GHBottomSheetProps,
} from "@gorhom/bottom-sheet";
import { BottomSheetDefaultBackdropProps } from "@gorhom/bottom-sheet/lib/typescript/components/bottomSheetBackdrop/types";
import {
  useMemo,
  useCallback,
  ReactNode,
  RefObject,
  useRef,
  useState,
} from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "@/shared/theme";

export interface BottomSheetProps
  extends Pick<
    GHBottomSheetProps,
    "enablePanDownToClose" | "onChange" | "snapPoints"
  > {
  backdrop?: boolean;
  backgroundColor?: string;
  children: ReactNode;
  onDismiss?: VoidFunction;
  ref?: RefObject<BottomSheetModal | null>;
}

export const BottomSheet = (props: BottomSheetProps) => {
  const {
    backdrop = true,
    backgroundColor,
    children,
    onDismiss,
    ref: injectedRef,
    snapPoints: injectedSnapPoints,
    ...rest
  } = props;

  const { colors } = useTheme();

  const insets = useSafeAreaInsets();

  const [isAtStart, setIsAtStart] = useState(false);

  const defaultRef = useRef<BottomSheetModal>(null);

  const ref = injectedRef ?? defaultRef;

  const snapPoints = useMemo(
    () => injectedSnapPoints ?? ["42.5%"],
    [injectedSnapPoints],
  );

  const handleDismiss = () => {
    if (onDismiss) {
      onDismiss();
    } else {
      ref.current?.close();
    }
  };

  const handleAnimate = (
    _: number,
    index: number,
    __: number,
    position: number,
  ) => {
    if (index < 0) onDismiss?.();
    if (position === 0) setIsAtStart(true);
    else setIsAtStart(false);
  };

  const renderBackdrop = useCallback(
    (props: BottomSheetDefaultBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        style={{ backgroundColor: colors.onSurface }}
        pressBehavior="close"
      />
    ),
    [],
  );

  return (
    <BottomSheetModal
      ref={ref}
      stackBehavior="push"
      overDragResistanceFactor={50}
      snapPoints={snapPoints}
      enableDynamicSizing={false}
      backdropComponent={backdrop ? renderBackdrop : undefined}
      onAnimate={handleAnimate}
      onDismiss={handleDismiss}
      backgroundStyle={{
        backgroundColor: backgroundColor ?? colors.background,
        borderRadius: 28,
      }}
      handleIndicatorStyle={{ backgroundColor: colors.onSurfaceVariant }}
      style={{ paddingTop: isAtStart ? insets.top : 0 }}
      {...rest}
    >
      {children}
    </BottomSheetModal>
  );
};
