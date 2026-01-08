import { WallPanel } from "@/types/panel";

export const samplePanels: WallPanel[] = [
  {
    id: "anthracite-classic",
    name: "Anthracite Classic",
    description:
      "Elegant anthracite panel with a modern matte finish, perfect for contemporary spaces.",
    category: "Premium",
    imageUrl: "/panels/panel.png",
    textureUrl: "/panels/panel.png",
    colors: ["#3D3D3D", "#2B2B2B", "#4A4A4A"],
    material: "Anthracite",
    price: "$125/m²",
  },
  {
    id: "anthracite-textured",
    name: "Anthracite Textured",
    description:
      "Sophisticated textured anthracite panel with subtle depth variations for visual interest.",
    category: "Premium",
    imageUrl: "/panels/panel2.png",
    textureUrl: "/panels/panel2.png",
    colors: ["#454545", "#333333", "#555555"],
    material: "Anthracite",
    price: "$135/m²",
  },
];

export const categories = ["All", "Premium"];
