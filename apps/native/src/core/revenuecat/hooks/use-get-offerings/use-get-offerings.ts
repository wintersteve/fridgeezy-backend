import { useQuery } from "@tanstack/react-query";

import { getOfferings } from "../../api/get-offerings";

export const useGetOfferings = () => {
  return useQuery({
    queryKey: ["REVENUECAT", "OFFERINGS"],
    queryFn: () => getOfferings(),
  });
};
