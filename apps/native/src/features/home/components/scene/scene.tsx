import { HomeTab } from "../../components/home-tab";
import { TabRoute } from "../../types";
import { SavedTab } from "../saved-tab";
import { SuggestTab } from "../suggest-tab";

export const Scene = ({ route }: { route: TabRoute }) => {
  switch (route.key) {
    case "home":
      return <HomeTab />;
    case "saved":
      return <SavedTab />;
    case "suggest":
      return <SuggestTab />;
    default:
      return null;
  }
};
