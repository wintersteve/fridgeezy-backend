import { Cuisine } from "@/shared/entities";

import { TabRoute } from "../types";

export const TABS: TabRoute[] = [
  { key: "home", title: "Home", icon: "inbox-full" },
  { key: "saved", title: "Saved", icon: "heart" },
  { key: "suggest", title: "Suggest", icon: "creation" },
];

export const TOP_CUISINES: {
  name: Cuisine;
  image: string;
}[] = [
  {
    name: "Italian",
    image:
      "https://images.unsplash.com/photo-1616299915952-04c803388e5f?q=80&w=2562&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
  },
  {
    name: "French",
    image:
      "https://images.unsplash.com/photo-1600663791817-d74f5196ba29?q=80&w=1287&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
  },
  {
    name: "Chinese",
    image:
      "https://images.unsplash.com/photo-1658863173663-607c0feef366?q=80&w=1287&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
  },
  {
    name: "Asian",
    image:
      "https://images.unsplash.com/photo-1611518040286-9af8ba97ab46?q=80&w=1287&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
  },
  {
    name: "Indian",
    image:
      "https://images.unsplash.com/photo-1618449840665-9ed506d73a34?q=80&w=1287&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
  },
  {
    name: "Thai",
    image:
      "https://images.unsplash.com/photo-1675150277436-9c7348972c11?q=80&w=2928&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
  },
  {
    name: "Mexican",
    image:
      "https://images.unsplash.com/photo-1629793980446-192d630f0dbe?q=80&w=1287&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
  },
  {
    name: "Spanish",
    image:
      "https://images.unsplash.com/photo-1571167366136-b57e07761625?q=80&w=1470&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
  },
  {
    name: "Korean",
    image:
      "https://images.unsplash.com/photo-1635363638580-c2809d049eee?q=80&w=2940&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
  },
];
