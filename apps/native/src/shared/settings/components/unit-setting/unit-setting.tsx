import { Switch } from "react-native-paper";

import { useUnitStore } from "@/shared/units";

import { SettingItem } from "../setting-item";

export const UnitSetting = () => {
  const unitStore = useUnitStore();

  const isMetric = unitStore.data.id === "METRIC";

  const handleChange = () => {
    if (isMetric) {
      unitStore.setImperial();
    } else {
      unitStore.setMetric();
    }
  };

  return (
    <SettingItem
      icon="temperature-celsius"
      title="Metric Units"
      right={<Switch value={isMetric} onChange={handleChange} />}
    />
  );
};
