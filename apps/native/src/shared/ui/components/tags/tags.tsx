import { TagData, TagsData } from "@/shared/supabase";
import { titleCase } from "@/shared/toolkit";
import { Chip, Row, Skeleton } from "@/shared/ui";

export interface TagsProps {
  data?: TagsData;
  isLoading: boolean;
  onPress: (id: TagData["id"]) => void;
  selected?: TagData["id"][];
}

const SKELETON_WIDTHS = [80, 70, 70, 90, 85, 100, 75, 95, 70, 90, 100, 74];

export const Tags = (props: TagsProps) => {
  const { data = [], isLoading = true, onPress, selected = [] } = props;

  const loading = SKELETON_WIDTHS.map((width, index) => (
    <Skeleton key={index} width={width} height={32} />
  ));

  const content = data.map((item) => (
    <Chip
      key={item.name}
      onPress={() => onPress(item.id)}
      selected={selected.includes(item.id)}
    >
      {titleCase(item.name)}
    </Chip>
  ));

  return <Row spacing={6}>{isLoading ? loading : content}</Row>;
};
