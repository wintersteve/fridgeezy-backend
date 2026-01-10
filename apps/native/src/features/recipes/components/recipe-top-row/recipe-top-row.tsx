import { Recipe } from "@/shared/entities";

import { ActionBar } from "../../components/action-bar";

export interface RecipeTopRowProps {
  data: Recipe;
}

export const RecipeTopRow = (props: RecipeTopRowProps) => {
  const { data } = props;

  return <ActionBar data={data} />;
};
