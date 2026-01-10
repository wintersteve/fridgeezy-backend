import { useState } from "react";
import { ViewStyle } from "react-native";
import {
  Calendar as RNCCalendar,
  CalendarProps as RNCCalendarProps,
  DateData,
} from "react-native-calendars";
import { Theme } from "react-native-calendars/src/types";

import { useTheme } from "@/shared/theme";

export interface CalendarDate {
  endDate: string;
  startDate: string;
}

export interface CalendarProps extends Omit<RNCCalendarProps, "date"> {
  date?: CalendarDate;
  disabled?: boolean;
  style?: ViewStyle;
  onChange: (value: string) => void;
}

const formatDate = (date: Date | string): string =>
  typeof date === "string" ? date : date.toISOString().split("T")[0];

export const Calendar = (props: CalendarProps) => {
  const { disabled = false, onChange, style } = props;

  const { colors } = useTheme();

  const today = new Date();

  const [date, setDate] = useState<string | null>(null);

  const marked = date
    ? {
        [date]: {
          selected: true,
          disableTouchEvent: true,
          selectedDotColor: "orange",
        },
      }
    : undefined;

  const theme = {
    arrowColor: colors.onBackground,
    calendarBackground: colors.transparent,
    dayTextColor: colors.onSurfaceVariant,
    disabledArrowColor: colors.onSurfaceDisabled,
    monthTextColor: colors.onBackground,
    selectedDayBackgroundColor: colors.primary,
    textMonthFontSize: 12,
    textDayHeaderFontSize: 11,
    textSectionTitleColor: colors.onBackground,
    textDayFontFamily: "Poppins",
    textDayFontSize: 12,
    textDisabledColor: colors.onSurfaceDisabled,
    textMonthFontFamily: "Poppins",
    textMonthFontWeight: 600,
    textDayHeaderFontWeight: 500,
    textDayHeaderFontFamily: "Poppins",
    todayTextColor: colors.onSurface,
  } as Theme;

  const handleDayPress = ({ dateString }: DateData) => {
    setDate(dateString);
    onChange(dateString);
  };

  return (
    <RNCCalendar
      disabledByDefault={disabled}
      disableAllTouchEventsForDisabledDays
      theme={theme}
      style={{ ...style }}
      markedDates={marked}
      onDayPress={handleDayPress}
      minDate={formatDate(today)}
      date={date ?? ""}
    />
  );
};
