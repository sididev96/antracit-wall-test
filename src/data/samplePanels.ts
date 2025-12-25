import { WallPanel } from "@/types/panel";

export const samplePanels: WallPanel[] = [
  {
    id: "oak-natural",
    name: "Natural Oak",
    description: "Classic oak wood panel with natural grain patterns and warm undertones",
    category: "Wood",
    imageUrl: "/panels/oak-natural.jpg",
    textureUrl: "/panels/oak-natural.jpg",
    colors: ["#C4A77D", "#8B7355", "#D4C4A8"],
    material: "Solid Oak",
    price: "$89/m²"
  },
  {
    id: "slate-charcoal",
    name: "Charcoal Slate",
    description: "Deep charcoal slate with subtle texture for modern industrial spaces",
    category: "Stone",
    imageUrl: "/panels/slate-charcoal.jpg",
    textureUrl: "/panels/slate-charcoal.jpg",
    colors: ["#36454F", "#4A4A4A", "#2F4F4F"],
    material: "Natural Slate",
    price: "$125/m²"
  },
  {
    id: "marble-white",
    name: "Carrara White",
    description: "Elegant white marble with classic gray veining",
    category: "Stone",
    imageUrl: "/panels/marble-white.jpg",
    textureUrl: "/panels/marble-white.jpg",
    colors: ["#F5F5F5", "#E8E8E8", "#C0C0C0"],
    material: "Marble Composite",
    price: "$145/m²"
  },
  {
    id: "walnut-dark",
    name: "Dark Walnut",
    description: "Rich dark walnut with sophisticated deep brown tones",
    category: "Wood",
    imageUrl: "/panels/walnut-dark.jpg",
    textureUrl: "/panels/walnut-dark.jpg",
    colors: ["#3E2723", "#5D4037", "#4E342E"],
    material: "Solid Walnut",
    price: "$115/m²"
  },
  {
    id: "concrete-gray",
    name: "Urban Concrete",
    description: "Industrial concrete finish with raw aesthetic appeal",
    category: "Industrial",
    imageUrl: "/panels/concrete-gray.jpg",
    textureUrl: "/panels/concrete-gray.jpg",
    colors: ["#808080", "#A9A9A9", "#696969"],
    material: "Concrete Effect",
    price: "$75/m²"
  },
  {
    id: "travertine-beige",
    name: "Travertine Beige",
    description: "Warm travertine stone with natural porous texture",
    category: "Stone",
    imageUrl: "/panels/travertine-beige.jpg",
    textureUrl: "/panels/travertine-beige.jpg",
    colors: ["#D4C4A8", "#C2B280", "#E8DCC4"],
    material: "Travertine",
    price: "$135/m²"
  },
  {
    id: "ash-white",
    name: "White Ash",
    description: "Light ash wood with clean Scandinavian aesthetic",
    category: "Wood",
    imageUrl: "/panels/ash-white.jpg",
    textureUrl: "/panels/ash-white.jpg",
    colors: ["#F5F5DC", "#E8E4D9", "#D9D5CA"],
    material: "Solid Ash",
    price: "$95/m²"
  },
  {
    id: "brick-rustic",
    name: "Rustic Brick",
    description: "Classic exposed brick look with weathered charm",
    category: "Industrial",
    imageUrl: "/panels/brick-rustic.jpg",
    textureUrl: "/panels/brick-rustic.jpg",
    colors: ["#8B4513", "#A0522D", "#CD853F"],
    material: "Brick Composite",
    price: "$85/m²"
  }
];

export const categories = ["All", "Wood", "Stone", "Industrial"];
