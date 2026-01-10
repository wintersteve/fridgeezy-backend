import { useThemeStorage } from "@/shared/theme";
import { Switch } from "@/shared/ui";

export const ThemeSetting = () => {
  const { data, set } = useThemeStorage();

  const handleChange = async () => {
    if (data === "DARK") {
      await set("LIGHT");
    } else {
      await set("DARK");
    }
  };

  return (
    <Switch
      label="This setting toggles the dark mode on and off"
      value={data === "DARK"}
      onChange={handleChange}
    />
  );
};
