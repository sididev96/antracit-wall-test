export interface WallPanel {
  id: string;
  name: string;
  description: string;
  category: string;
  imageUrl: string;
  textureUrl: string;
  colors: string[];
  material: string;
  price?: string;
}

export interface VisualizerState {
  uploadedImage: string | null;
  selectedPanel: WallPanel | null;
  wallMask: string | null;
  isProcessing: boolean;
}
