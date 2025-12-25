import { WallPanel } from "@/types/panel";

export const samplePanels: WallPanel[] = [
  {
    id: "oak-natural",
    name: "Natural Oak",
    description: "Classic oak wood panel with natural grain patterns and warm undertones",
    category: "Wood",
    imageUrl: "/panels/oak-natural.png",
    textureUrl: "/panels/oak-natural.png",
    colors: ["#C4A77D", "#8B7355", "#D4C4A8"],
    material: "Solid Oak",
    price: "$89/m²"
  },
  {
    id: "slate-charcoal",
    name: "Charcoal Slate",
    description: "Deep charcoal slate with subtle texture for modern industrial spaces",
    category: "Stone",
    imageUrl: "/panels/slate-charcoal.png",
    textureUrl: "/panels/slate-charcoal.png",
    colors: ["#36454F", "#4A4A4A", "#2F4F4F"],
    material: "Natural Slate",
    price: "$125/m²"
  },
  {
    id: "marble-white",
    name: "Carrara White",
    description: "Elegant white marble with classic gray veining",
    category: "Stone",
    imageUrl: "/panels/marble-white.png",
    textureUrl: "/panels/marble-white.png",
    colors: ["#F5F5F5", "#E8E8E8", "#C0C0C0"],
    material: "Marble Composite",
    price: "$145/m²"
  },
  {
    id: "walnut-dark",
    name: "Dark Walnut",
    description: "Rich dark walnut with sophisticated deep brown tones",
    category: "Wood",
    imageUrl: "/panels/walnut-dark.png",
    textureUrl: "/panels/walnut-dark.png",
    colors: ["#3E2723", "#5D4037", "#4E342E"],
    material: "Solid Walnut",
    price: "$115/m²"
  },
  {
    id: "concrete-gray",
    name: "Urban Concrete",
    description: "Industrial concrete finish with raw aesthetic appeal",
    category: "Industrial",
    imageUrl: "/panels/concrete-gray.png",
    textureUrl: "/panels/concrete-gray.png",
    colors: ["#808080", "#A9A9A9", "#696969"],
    material: "Concrete Effect",
    price: "$75/m²"
  },
  {
    id: "travertine-beige",
    name: "Travertine Beige",
    description: "Warm travertine stone with natural porous texture",
    category: "Stone",
    imageUrl: "/panels/travertine-beige.png",
    textureUrl: "/panels/travertine-beige.png",
    colors: ["#D4C4A8", "#C2B280", "#E8DCC4"],
    material: "Travertine",
    price: "$135/m²"
  },
  {
    id: "ash-white",
    name: "White Ash",
    description: "Light ash wood with clean Scandinavian aesthetic",
    category: "Wood",
    imageUrl: "/panels/ash-white.png",
    textureUrl: "/panels/ash-white.png",
    colors: ["#F5F5DC", "#E8E4D9", "#D9D5CA"],
    material: "Solid Ash",
    price: "$95/m²"
  },
  {
    id: "brick-rustic",
    name: "Rustic Brick",
    description: "Classic exposed brick look with weathered charm",
    category: "Industrial",
    imageUrl: "/panels/brick-rustic.png",
    textureUrl: "/panels/brick-rustic.png",
    colors: ["#8B4513", "#A0522D", "#CD853F"],
    material: "Brick Composite",
    price: "$85/m²"
  }
];

export const categories = ["All", "Wood", "Stone", "Industrial"];
