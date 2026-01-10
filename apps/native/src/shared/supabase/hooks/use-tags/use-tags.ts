import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/core/supabase";
import { Enums, Tables } from "@/shared/supabase/types";

export type TagData = Tables<"tags">;

export type TagsData = TagData[];

export const useTags = (type: Enums<"tag_type">) => {
  const { data, ...rest } = useQuery({
    queryKey: ["SUPABASE", "TAGS", type],
    queryFn: async () => {
      const { data } = await supabase
        .from("tags")
        .select("*")
        .eq("type", type)
        .order("name");

      return data as TagsData;
    },
  });

  return { data, ...rest };
};
