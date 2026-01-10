import { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Circle } from "react-native-svg";

import { useTheme } from "@/shared/theme";

export type CircularProgressProps = {
  children?: ReactNode;
  color?: string;
  value: number;
  size?: number;
  strokeColor?: string;
  thickness?: number;
};

export const CircularProgress = ({
  children,
  color,
  value,
  size = 40,
  strokeColor: injectedStrokeColor,
  thickness = 4,
}: CircularProgressProps) => {
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - value);

  const { colors } = useTheme();

  const strokeColor = injectedStrokeColor ?? colors.primaryContainer;

  return (
    <View
      style={{
        width: size,
        height: size,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <Svg width={size} height={size}>
        <Circle
          stroke={color ?? colors.primary}
          fill="none"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={thickness}
        />
        <Circle
          stroke={strokeColor}
          fill="none"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={thickness}
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          rotation="-90"
          origin={`${size / 2}, ${size / 2}`}
        />
      </Svg>
      <View
        style={[
          StyleSheet.absoluteFillObject,
          { alignItems: "center", justifyContent: "center" },
        ]}
      >
        {children}
      </View>
    </View>
  );
};
