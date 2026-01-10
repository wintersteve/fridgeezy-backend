import { BottomSheetModal } from "@gorhom/bottom-sheet";
import {
  ReactNode,
  Ref,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { View } from "react-native";
import { Text } from "react-native-paper";

import { useTheme } from "@/shared/theme";
import { titleCase } from "@/shared/toolkit";
import {
  BottomSheet,
  Button,
  Chip,
  ChipProps,
  Row,
  ScrollView,
} from "@/shared/ui";

export interface FilterBottomSheetRef {
  open: () => void;
  close: () => void;
}

export interface FilterBottomSheetProps extends Pick<ChipProps, "disabled"> {
  children?: ReactNode | ((props: { onPress: () => void }) => ReactNode);
  description: string;
  onChange: (value: string[]) => void;
  options: string[];
  ref?: Ref<FilterBottomSheetRef>;
  singleSelect?: boolean;
  title: string;
  value: string[];
}

export const FilterBottomSheet = (props: FilterBottomSheetProps) => {
  const {
    children,
    description,
    disabled,
    onChange,
    options,
    ref,
    singleSelect = false,
    title,
    value,
  } = props;

  const theme = useTheme();

  const bottomSheetRef = useRef<BottomSheetModal>(null);
  const [draftValue, setDraftValue] = useState<string[]>(value);

  useEffect(() => {
    setDraftValue(value);
  }, [value]);

  const handleOpen = () => {
    setDraftValue(value);
    bottomSheetRef.current?.present();
  };

  const handleClose = () => {
    bottomSheetRef.current?.dismiss();
  };

  const handleToggle = (id: string) => {
    if (singleSelect) {
      onChange([id]);
      handleClose();
    } else {
      setDraftValue((prev) =>
        prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
      );
    }
  };

  const handleConfirm = () => {
    onChange(draftValue);
    handleClose();
  };

  useImperativeHandle(ref, () => ({
    open: handleOpen,
    close: handleClose,
  }));

  const renderTrigger = () => {
    if (typeof children === "function") {
      return children({ onPress: handleOpen });
    }

    if (children) {
      return children;
    }

    return (
      <Chip
        borderRadius={8}
        disabled={disabled}
        mode="outlined"
        selected={value.length > 0 ? value.length : undefined}
        onPress={handleOpen}
      >
        {title}
      </Chip>
    );
  };

  return (
    <View>
      {renderTrigger()}
      <BottomSheet ref={bottomSheetRef} snapPoints={["70%"]}>
        <View
          style={{
            flex: 1,
            paddingHorizontal: 20,
            paddingTop: 8,
          }}
        >
          <ScrollView style={{ flex: 1 }}>
            <View style={{ alignItems: "center", gap: 4 }}>
              <Text
                variant="headlineMedium"
                style={{ color: theme.colors.onSurface }}
              >
                {title}
              </Text>
              <Text style={{ color: theme.colors.onSurfaceVariant }}>
                {description}
              </Text>
            </View>
            <Row spacing={6} style={{ marginVertical: 12 }}>
              {options.map((id) => (
                <Chip
                  key={id}
                  selected={draftValue.includes(id)}
                  onPress={() => handleToggle(id)}
                >
                  {titleCase(id)}
                </Chip>
              ))}
            </Row>
          </ScrollView>
          <Button
            size="sm"
            onPress={handleConfirm}
            style={{
              width: "100%",
              marginTop: 8,
              marginBottom: 32,
            }}
          >
            Confirm
          </Button>
        </View>
      </BottomSheet>
    </View>
  );
};
