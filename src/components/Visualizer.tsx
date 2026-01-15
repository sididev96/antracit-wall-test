import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { ImageUploader } from "./ImageUploader";
import { PanelSelector } from "./PanelSelector";
import { WallPanel } from "@/types/panel";
import {
  ArrowRight,
  Loader2,
  ChevronRight,
  Move,
  RotateCcw,
  Wand2,
  Download,
  ZoomIn,
  ZoomOut,
  Crosshair,
} from "lucide-react";
import { Button } from "./ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  estimateDepth,
  sampleDepthAt,
  DepthMapResult,
} from "@/lib/depthService";
import {
  segmentWalls,
  WallSegmentationResult,
  isPointOnWall,
  findBestRectangleForPanel,
  fitPanelToRectangle,
} from "@/lib/segmentationService";

type Step =
  | "upload"
  | "processing-depth"
  | "processing-walls"
  | "place-panel"
  | "result";

interface PanelTransform {
  x: number;
  y: number;
  scale: number;
}

interface PanelDimensions {
  width: number;
  height: number;
  loaded: boolean;
}

export function Visualizer() {
  const [step, setStep] = useState<Step>("upload");
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [depthMap, setDepthMap] = useState<DepthMapResult | null>(null);
  const [wallSegmentation, setWallSegmentation] =
    useState<WallSegmentationResult | null>(null);
  const [selectedPanel, setSelectedPanel] = useState<WallPanel | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingStatus, setLoadingStatus] = useState("");

  // Wall mask as CSS clip-path URL for clipping the panel
  const [wallMaskUrl, setWallMaskUrl] = useState<string | null>(null);

  // Depth-enhanced foreground mask URL (combines segmentation + depth for precision)
  const [enhancedForegroundMaskUrl, setEnhancedForegroundMaskUrl] = useState<string | null>(null);

  // Panel transform state
  const [panelTransform, setPanelTransform] = useState<PanelTransform>({
    x: 0,
    y: 0,
    scale: 1,
  });
  const [panelDimensions, setPanelDimensions] = useState<PanelDimensions>({
    width: 200,
    height: 400,
    loaded: false,
  });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(
    null
  );
  const [depthAtPanel, setDepthAtPanel] = useState<number>(0.5);
  const [isOnWall, setIsOnWall] = useState<boolean>(false);

  // Just use the segmentation foreground mask directly - depth enhancement causes issues
  // The enhanced mask is disabled, we'll use wallSegmentation.foregroundMaskUrl directly
  useEffect(() => {
    // Don't create enhanced mask - just use the segmentation directly
    setEnhancedForegroundMaskUrl(null);
  }, [depthMap, wallSegmentation]);

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const imageDimensions = useRef<{ width: number; height: number }>({
    width: 800,
    height: 600,
  });

  // Load panel dimensions when panel is selected
  useEffect(() => {
    if (!selectedPanel) {
      setPanelDimensions({ width: 200, height: 400, loaded: false });
      return;
    }

    const img = new Image();
    img.onload = () => {
      setPanelDimensions({
        width: img.naturalWidth,
        height: img.naturalHeight,
        loaded: true,
      });
    };
    img.src = selectedPanel.textureUrl;
  }, [selectedPanel]);

  // Handle image upload and depth estimation + wall segmentation
  const handleImageUpload = useCallback(async (imageUrl: string) => {
    setUploadedImage(imageUrl);
    setStep("processing-depth");
    setIsProcessing(true);
    setLoadingProgress(0);
    setLoadingStatus("Initializing AI models...");

    try {
      // First: estimate depth
      const depth = await estimateDepth(imageUrl, (progress, status) => {
        setLoadingProgress(progress * 0.5); // 50% for depth
        setLoadingStatus(status);
      });

      setDepthMap(depth);
      setStep("processing-walls");

      // Second: segment walls using ML model
      let walls: WallSegmentationResult | null = null;
      try {
        walls = await segmentWalls(imageUrl, (progress, status) => {
          setLoadingProgress(50 + progress * 0.5); // Remaining 50% for walls
          setLoadingStatus(status);
        });
        setWallSegmentation(walls);
      } catch (wallError) {
        console.warn(
          "Wall segmentation failed, continuing without it:",
          wallError
        );
        setWallSegmentation(null);
      }

      setStep("place-panel");

      if (walls && walls.wallArea > 0) {
        toast.success(
          `Wall detection complete! ${(walls.wallArea * 100).toFixed(
            1
          )}% of image is wall. Drag panel onto the wall.`
        );
      } else {
        toast.info(
          "Ready! Drag panel to position. Wall detection unavailable."
        );
      }
    } catch (error) {
      console.error("Failed to process image:", error);
      toast.error("Failed to analyze image. Please try again.");
      setStep("upload");
    } finally {
      setIsProcessing(false);
    }
  }, []);

  const handleClearImage = useCallback(() => {
    setUploadedImage(null);
    setDepthMap(null);
    setWallSegmentation(null);
    setSelectedPanel(null);
    setWallMaskUrl(null);
    setEnhancedForegroundMaskUrl(null);
    setPanelTransform({ x: 0, y: 0, scale: 1 });
    setPanelRotation({ rotateX: 0, rotateY: 0 });
    setIsOnWall(false);
    setStep("upload");
  }, []);

  // Calculate perspective and scale based on wall segmentation and depth
  const calculateWallAwarePerspective = useCallback(
    (
      centerX: number,
      centerY: number,
      panelWidth: number,
      panelHeight: number
    ) => {
      if (!containerRef.current)
        return { rotateX: 0, rotateY: 0, scale: 1, onWall: false };

      const container = containerRef.current;
      const rect = container.getBoundingClientRect();

      // Normalize coordinates to 0-1 range
      const normalizedX = centerX / rect.width;
      const normalizedY = centerY / rect.height;
      const normalizedPanelWidth = panelWidth / rect.width;
      const normalizedPanelHeight = panelHeight / rect.height;

      // Check if point is on wall
      let onWall = false;
      if (wallSegmentation && wallSegmentation.wallMask.length > 0) {
        onWall = isPointOnWall(
          wallSegmentation.wallMask,
          wallSegmentation.width,
          wallSegmentation.height,
          normalizedX,
          normalizedY
        );
      }

      // Calculate perspective from depth gradient
      if (depthMap) {
        const { depthData, width: depthWidth, height: depthHeight } = depthMap;

        // Sample depth at panel center
        const centerDepth = sampleDepthAt(
          depthData,
          depthWidth,
          depthHeight,
          normalizedX,
          normalizedY
        );

        // Sample depth at left and right edges of the panel to calculate horizontal tilt
        const leftX = Math.max(0, normalizedX - normalizedPanelWidth / 2);
        const rightX = Math.min(1, normalizedX + normalizedPanelWidth / 2);
        const leftDepth = sampleDepthAt(
          depthData,
          depthWidth,
          depthHeight,
          leftX,
          normalizedY
        );
        const rightDepth = sampleDepthAt(
          depthData,
          depthWidth,
          depthHeight,
          rightX,
          normalizedY
        );

        // Sample depth at top and bottom edges for vertical tilt
        const topY = Math.max(0, normalizedY - normalizedPanelHeight / 2);
        const bottomY = Math.min(1, normalizedY + normalizedPanelHeight / 2);
        const topDepth = sampleDepthAt(
          depthData,
          depthWidth,
          depthHeight,
          normalizedX,
          topY
        );
        const bottomDepth = sampleDepthAt(
          depthData,
          depthWidth,
          depthHeight,
          normalizedX,
          bottomY
        );

        // Calculate horizontal tilt (rotateY) based on left-right depth difference
        // If right side is closer (higher depth), rotate panel to face right
        const horizontalDepthDiff = rightDepth - leftDepth; // Inverted
        // Multiply by a factor to get reasonable tilt angles (max ~50 degrees)
        const rotateY = horizontalDepthDiff * 120;

        // Calculate vertical tilt (rotateX) based on top-bottom depth difference
        // If top is closer (higher depth), tilt panel backward
        const verticalDepthDiff = topDepth - bottomDepth; // Inverted
        const rotateX = verticalDepthDiff * 80;

        return {
          rotateX: Math.max(-45, Math.min(45, rotateX)),
          rotateY: Math.max(-55, Math.min(55, rotateY)),
          scale: 1,
          onWall,
        };
      }

      // Fallback: use wall plane normals if available
      if (wallSegmentation && wallSegmentation.wallPlanes.length > 0) {
        // Find closest wall plane
        let closest = wallSegmentation.wallPlanes[0];
        let minDist = Infinity;
        for (const plane of wallSegmentation.wallPlanes) {
          const dist = Math.sqrt(
            (normalizedX - plane.centerX) ** 2 +
            (normalizedY - plane.centerY) ** 2
          );
          if (dist < minDist) {
            minDist = dist;
            closest = plane;
          }
        }

        const rotateY = -closest.normalX * 50; // Inverted
        const rotateX = -closest.normalY * 40; // Inverted

        return {
          rotateX: Math.max(-45, Math.min(45, rotateX)),
          rotateY: Math.max(-55, Math.min(55, rotateY)),
          scale: 1,
          onWall,
        };
      }

      // Final fallback: position-based perspective
      const relativeX = normalizedX - 0.5;
      const relativeY = normalizedY - 0.5;

      const rotateY = relativeX * 40; // Inverted
      const rotateX = -relativeY * 30; // Inverted

      return {
        rotateX: Math.max(-45, Math.min(45, rotateX)),
        rotateY: Math.max(-55, Math.min(55, rotateY)),
        scale: 1,
        onWall: false,
      };
    },
    [wallSegmentation, depthMap]
  );

  // Separate state for rotation to avoid infinite loops
  const [panelRotation, setPanelRotation] = useState({
    rotateX: 0,
    rotateY: 0,
  });

  // Calculate base panel size based on wall bounding box for proper scaling
  const getBasePanelSize = useCallback(() => {
    if (!containerRef.current) return { width: 150, height: 300 };

    const container = containerRef.current;
    const rect = container.getBoundingClientRect();
    const panelAspectRatio = panelDimensions.loaded
      ? panelDimensions.width / panelDimensions.height
      : 0.5;

    // If we have wall segmentation, size panel to roughly fit the largest wall
    if (wallSegmentation && wallSegmentation.wallPlanes.length > 0) {
      // Find the largest wall plane
      const largestWall = wallSegmentation.wallPlanes.reduce(
        (largest, plane) => (plane.area > largest.area ? plane : largest),
        wallSegmentation.wallPlanes[0]
      );

      // Use the bounding box of the largest wall
      const wallBox = largestWall.boundingBox;
      const wallWidthPx = (wallBox.xmax - wallBox.xmin) * rect.width;
      const wallHeightPx = (wallBox.ymax - wallBox.ymin) * rect.height;

      // Size panel to fill ~80-90% of the wall, respecting panel aspect ratio
      let targetWidth, targetHeight;

      // Fit by height first, then check if width overflows
      targetHeight = wallHeightPx * 0.85;
      targetWidth = targetHeight * panelAspectRatio;

      // If width overflows wall, fit by width instead
      if (targetWidth > wallWidthPx * 0.9) {
        targetWidth = wallWidthPx * 0.9;
        targetHeight = targetWidth / panelAspectRatio;
      }

      return {
        width: Math.max(100, targetWidth),
        height: Math.max(150, targetHeight),
      };
    }

    // Fallback: use overall wall bounding box if available
    if (wallSegmentation && wallSegmentation.wallBoundingBox) {
      const wallBox = wallSegmentation.wallBoundingBox;
      const wallWidthPx = (wallBox.xmax - wallBox.xmin) * rect.width;
      const wallHeightPx = (wallBox.ymax - wallBox.ymin) * rect.height;

      let targetHeight = wallHeightPx * 0.8;
      let targetWidth = targetHeight * panelAspectRatio;

      if (targetWidth > wallWidthPx * 0.85) {
        targetWidth = wallWidthPx * 0.85;
        targetHeight = targetWidth / panelAspectRatio;
      }

      return {
        width: Math.max(100, targetWidth),
        height: Math.max(150, targetHeight),
      };
    }

    // Fallback: use fixed base size
    const BASE_HEIGHT = 250;
    return {
      width: BASE_HEIGHT * panelAspectRatio,
      height: BASE_HEIGHT,
    };
  }, [wallSegmentation, panelDimensions]);

  // Calculate actual scaled panel dimensions using wall-aware base size
  const basePanelSize = getBasePanelSize();
  const aspectRatio = panelDimensions.loaded
    ? panelDimensions.width / panelDimensions.height
    : 0.5;

  // Calculate depth-based scale: closer (high depth) = larger, farther (low depth) = smaller
  // Depth values: higher = closer to camera, lower = farther from camera
  // Scale range: 1.4 (closest) to 0.6 (farthest)
  const depthScaleFactor = 0.6 + depthAtPanel * 0.8;
  const clampedDepthScale = Math.max(0.6, Math.min(1.4, depthScaleFactor));

  const scaledPanelHeight =
    basePanelSize.height * panelTransform.scale * clampedDepthScale;
  const scaledPanelWidth = scaledPanelHeight * aspectRatio;

  // Update perspective, scale, and wall detection when panel position changes
  useEffect(() => {
    if (!depthMap || step !== "place-panel" || !containerRef.current) return;

    const container = containerRef.current;
    const rect = container.getBoundingClientRect();

    // Calculate center of panel
    const centerX = panelTransform.x + scaledPanelWidth / 2;
    const centerY = panelTransform.y + scaledPanelHeight / 2;

    // Get wall-aware perspective using panel dimensions for depth gradient sampling
    const perspective = calculateWallAwarePerspective(
      centerX,
      centerY,
      scaledPanelWidth,
      scaledPanelHeight
    );
    setPanelRotation({
      rotateX: perspective.rotateX,
      rotateY: perspective.rotateY,
    });
    setIsOnWall(perspective.onWall);

    // Track depth at panel center for brightness adjustment and size scaling
    const normalizedX = Math.max(0, Math.min(1, centerX / rect.width));
    const normalizedY = Math.max(0, Math.min(1, centerY / rect.height));
    const depth = sampleDepthAt(
      depthMap.depthData,
      depthMap.width,
      depthMap.height,
      normalizedX,
      normalizedY
    );
    setDepthAtPanel(depth);
  }, [
    panelTransform.x,
    panelTransform.y,
    panelTransform.scale,
    scaledPanelWidth,
    scaledPanelHeight,
    depthMap,
    step,
    calculateWallAwarePerspective,
  ]);

  // Drag handlers
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!selectedPanel) return;
      e.preventDefault();
      setIsDragging(true);
      setDragStart({
        x: e.clientX - panelTransform.x,
        y: e.clientY - panelTransform.y,
      });
    },
    [selectedPanel, panelTransform.x, panelTransform.y]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging || !dragStart) return;

      const newX = e.clientX - dragStart.x;
      const newY = e.clientY - dragStart.y;

      setPanelTransform((prev) => ({
        ...prev,
        x: newX,
        y: newY,
      }));
    },
    [isDragging, dragStart]
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    setDragStart(null);
  }, []);

  // Touch handlers for mobile
  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (!selectedPanel) return;
      const touch = e.touches[0];
      setIsDragging(true);
      setDragStart({
        x: touch.clientX - panelTransform.x,
        y: touch.clientY - panelTransform.y,
      });
    },
    [selectedPanel, panelTransform.x, panelTransform.y]
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!isDragging || !dragStart) return;
      const touch = e.touches[0];

      const newX = touch.clientX - dragStart.x;
      const newY = touch.clientY - dragStart.y;

      setPanelTransform((prev) => ({
        ...prev,
        x: newX,
        y: newY,
      }));
    },
    [isDragging, dragStart]
  );

  const handleTouchEnd = useCallback(() => {
    setIsDragging(false);
    setDragStart(null);
  }, []);

  // Scale handlers
  const handleScaleUp = useCallback(() => {
    setPanelTransform((prev) => ({
      ...prev,
      scale: Math.min(3, prev.scale + 0.2),
    }));
  }, []);

  const handleScaleDown = useCallback(() => {
    setPanelTransform((prev) => ({
      ...prev,
      scale: Math.max(0.3, prev.scale - 0.2),
    }));
  }, []);

  const handleResetTransform = useCallback(() => {
    setPanelTransform({ x: 0, y: 0, scale: 1 });
    setPanelRotation({ rotateX: 0, rotateY: 0 });
  }, []);

  // Snap panel to best detected rectangle
  const handleSnapToWall = useCallback(() => {
    if (!wallSegmentation || !containerRef.current || !selectedPanel || !panelDimensions.loaded) {
      toast.error("No wall rectangles detected");
      return;
    }

    const rectangles = wallSegmentation.detectedRectangles;
    if (!rectangles || rectangles.length === 0) {
      toast.error("No rectangular wall areas detected");
      return;
    }

    const container = containerRef.current;
    const rect = container.getBoundingClientRect();

    // Calculate panel aspect ratio
    const panelAspectRatio = panelDimensions.width / panelDimensions.height;

    // Find the best rectangle for this panel
    const bestRect = findBestRectangleForPanel(rectangles, panelAspectRatio, 0.01);

    if (!bestRect) {
      toast.error("No suitable wall area found");
      return;
    }

    console.log("[Snap] Best rectangle:", bestRect);
    console.log("[Snap] Container size:", rect.width, rect.height);

    // Calculate target dimensions in pixels
    const targetHeight = bestRect.height * rect.height;
    const targetWidth = Math.min(bestRect.width * rect.width, targetHeight * panelAspectRatio);

    // Calculate position (top-left corner of rectangle, centered horizontally)
    const rectLeft = bestRect.boundingBox.xmin * rect.width;
    const rectTop = bestRect.boundingBox.ymin * rect.height;
    const rectWidth = bestRect.width * rect.width;
    const offsetX = (rectWidth - targetWidth) / 2;

    const targetX = rectLeft + offsetX;
    const targetY = rectTop;

    console.log("[Snap] Target position:", targetX, targetY);
    console.log("[Snap] Target size:", targetWidth, targetHeight);

    // Calculate the scale needed to achieve target height
    // scaledPanelHeight = basePanelSize.height * scale * depthScale
    // We want: targetHeight = basePanelSize.height * newScale * depthScale
    // So: newScale = targetHeight / (basePanelSize.height * depthScale)
    const baseSize = getBasePanelSize();
    const depthScaleFactor = 0.6 + depthAtPanel * 0.8;
    const clampedDepthScale = Math.max(0.6, Math.min(1.4, depthScaleFactor));

    const newScale = targetHeight / (baseSize.height * clampedDepthScale);

    console.log("[Snap] Base size:", baseSize);
    console.log("[Snap] Depth scale:", clampedDepthScale);
    console.log("[Snap] New scale:", newScale);

    setPanelTransform({
      x: targetX,
      y: targetY,
      scale: Math.max(0.3, Math.min(5, newScale)),
    });

    // Update rotation based on wall plane
    const perspective = calculateWallAwarePerspective(
      targetX + targetWidth / 2,
      targetY + targetHeight / 2,
      targetWidth,
      targetHeight
    );
    setPanelRotation({
      rotateX: perspective.rotateX,
      rotateY: perspective.rotateY,
    });

    toast.success("Panel snapped to wall!");
  }, [wallSegmentation, selectedPanel, panelDimensions, calculateWallAwarePerspective, depthAtPanel, getBasePanelSize]);

  const handleSelectPanel = useCallback(
    (panel: WallPanel) => {
      setSelectedPanel(panel);

      // If we have wall segmentation, position panel on the largest wall
      if (
        wallSegmentation &&
        wallSegmentation.wallPlanes.length > 0 &&
        containerRef.current
      ) {
        const container = containerRef.current;
        const rect = container.getBoundingClientRect();

        // Find the largest wall plane
        const largestWall = wallSegmentation.wallPlanes.reduce(
          (largest, plane) => (plane.area > largest.area ? plane : largest),
          wallSegmentation.wallPlanes[0]
        );

        // Position panel at the center of the largest wall
        const centerX = largestWall.centerX * rect.width;
        const centerY = largestWall.centerY * rect.height;

        // Offset by half panel size to center it
        const panelWidth = 150; // Base panel width
        const panelHeight = 300; // Base panel height

        setPanelTransform({
          x: centerX - panelWidth / 2,
          y: centerY - panelHeight / 2,
          scale: 1,
        });

        toast.success(`${panel.name} placed on wall! Drag to reposition.`);
      } else if (
        wallSegmentation &&
        wallSegmentation.wallBoundingBox &&
        containerRef.current
      ) {
        // Fallback: use wall bounding box center
        const container = containerRef.current;
        const rect = container.getBoundingClientRect();
        const box = wallSegmentation.wallBoundingBox;

        const centerX = ((box.xmin + box.xmax) / 2) * rect.width;
        const centerY = ((box.ymin + box.ymax) / 2) * rect.height;

        setPanelTransform({
          x: centerX - 75,
          y: centerY - 150,
          scale: 1,
        });

        toast.success(`${panel.name} placed on wall! Drag to reposition.`);
      } else {
        // No wall segmentation - place at default position
        setPanelTransform({ x: 50, y: 50, scale: 1 });
        toast.success(
          `${panel.name} selected! Drag it to position on your wall.`
        );
      }
    },
    [wallSegmentation]
  );

  const handleDownload = useCallback(async () => {
    if (!uploadedImage || !selectedPanel || !containerRef.current) {
      toast.error("Please select a panel first.");
      return;
    }

    setIsProcessing(true);
    try {
      // Create a canvas to render the composite
      const canvas = document.createElement("canvas");
      const container = containerRef.current;
      const rect = container.getBoundingClientRect();

      canvas.width = rect.width;
      canvas.height = rect.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        throw new Error("Failed to get canvas context");
      }

      // Load images
      const loadImage = (src: string): Promise<HTMLImageElement> => {
        return new Promise((resolve, reject) => {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = src;
        });
      };

      const bgImg = await loadImage(uploadedImage);
      const panelImg = await loadImage(selectedPanel.textureUrl);

      // Draw background
      ctx.drawImage(bgImg, 0, 0, canvas.width, canvas.height);

      // If we have wall segmentation, clip the panel to wall areas
      if (wallSegmentation && wallSegmentation.wallMask.length > 0) {
        ctx.save();

        // Create clipping path from wall mask
        const maskScaleX = canvas.width / wallSegmentation.width;
        const maskScaleY = canvas.height / wallSegmentation.height;

        ctx.beginPath();
        // Use edge detection to create path - sample at intervals
        const step = 2;
        for (let y = 0; y < wallSegmentation.height; y += step) {
          for (let x = 0; x < wallSegmentation.width; x += step) {
            const idx = y * wallSegmentation.width + x;
            if (wallSegmentation.wallMask[idx] > 0) {
              ctx.rect(
                x * maskScaleX,
                y * maskScaleY,
                step * maskScaleX,
                step * maskScaleY
              );
            }
          }
        }
        ctx.clip();
      }

      // Save context state for panel transform
      ctx.save();

      // Move to panel center
      const centerX = panelTransform.x + scaledPanelWidth / 2;
      const centerY = panelTransform.y + scaledPanelHeight / 2;
      ctx.translate(centerX, centerY);

      // Apply rotation (convert deg to rad)
      const rotXRad = (panelRotation.rotateX * Math.PI) / 180;
      const rotYRad = (panelRotation.rotateY * Math.PI) / 180;

      // Approximate 3D rotation with 2D skew
      const skewX = Math.tan(rotYRad) * 0.3;
      const skewY = Math.tan(rotXRad) * 0.3;
      ctx.transform(1, skewY, skewX, 1, 0, 0);

      // Draw panel centered
      ctx.drawImage(
        panelImg,
        -scaledPanelWidth / 2,
        -scaledPanelHeight / 2,
        scaledPanelWidth,
        scaledPanelHeight
      );

      // Restore panel transform context
      ctx.restore();

      // Restore wall clipping context if it was applied
      if (wallSegmentation && wallSegmentation.wallMask.length > 0) {
        ctx.restore();

        // Now draw foreground objects on top (non-wall pixels from original image)
        // Create a temporary canvas to apply the foreground mask
        const fgCanvas = document.createElement("canvas");
        fgCanvas.width = canvas.width;
        fgCanvas.height = canvas.height;
        const fgCtx = fgCanvas.getContext("2d")!;

        // Draw the original image
        fgCtx.drawImage(bgImg, 0, 0, canvas.width, canvas.height);

        // Get the foreground pixels (non-wall) from original and composite them
        const fgImageData = fgCtx.getImageData(0, 0, canvas.width, canvas.height);
        const mainImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

        const maskScaleX = canvas.width / wallSegmentation.width;
        const maskScaleY = canvas.height / wallSegmentation.height;

        for (let y = 0; y < canvas.height; y++) {
          for (let x = 0; x < canvas.width; x++) {
            const mx = Math.floor(x / maskScaleX);
            const my = Math.floor(y / maskScaleY);
            const maskIdx = my * wallSegmentation.width + mx;

            // If this pixel is NOT a wall (foreground object), use original image
            if (wallSegmentation.wallMask[maskIdx] === 0) {
              const pixelIdx = (y * canvas.width + x) * 4;
              mainImageData.data[pixelIdx] = fgImageData.data[pixelIdx];
              mainImageData.data[pixelIdx + 1] = fgImageData.data[pixelIdx + 1];
              mainImageData.data[pixelIdx + 2] = fgImageData.data[pixelIdx + 2];
              mainImageData.data[pixelIdx + 3] = fgImageData.data[pixelIdx + 3];
            }
          }
        }

        ctx.putImageData(mainImageData, 0, 0);
      }

      // Download
      const link = document.createElement("a");
      link.download = "wall-visualization.png";
      link.href = canvas.toDataURL("image/png");
      link.click();

      toast.success("Image downloaded!");
    } catch (error) {
      console.error("Failed to download:", error);
      toast.error("Failed to download image.");
    } finally {
      setIsProcessing(false);
    }
  }, [
    uploadedImage,
    selectedPanel,
    wallSegmentation,
    panelTransform,
    scaledPanelWidth,
    scaledPanelHeight,
    panelRotation,
  ]);

  const handleReset = useCallback(() => {
    handleClearImage();
  }, [handleClearImage]);

  const steps = [
    { key: "upload", label: "Upload Photo" },
    { key: "place-panel", label: "Place Panel" },
    { key: "result", label: "Download" },
  ];

  const getStepIndex = (s: Step) => {
    if (s === "processing-depth" || s === "processing-walls") return 0;
    return steps.findIndex((st) => st.key === s);
  };

  const currentStepIndex = getStepIndex(step);

  return (
    <section id="visualizer" className="py-20 bg-background">
      <div className="container mx-auto px-4">
        <div className="text-center mb-12 animate-slide-up">
          <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
            Visualize Your Space
          </h2>
          <p className="text-muted-foreground max-w-xl mx-auto">
            Upload a photo, select a panel, and drag it onto your wall. AI
            detects walls and adjusts panel perspective automatically.
          </p>
        </div>

        {/* Progress steps */}
        <div className="flex items-center justify-center gap-2 mb-12">
          {steps.map((s, i) => (
            <div key={s.key} className="flex items-center">
              <div
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all duration-300",
                  i <= currentStepIndex
                    ? "bg-anthracite text-primary-foreground"
                    : "bg-muted text-muted-foreground"
                )}
              >
                <span className="w-5 h-5 rounded-full bg-current/20 flex items-center justify-center text-xs">
                  {i + 1}
                </span>
                <span className="hidden sm:inline">{s.label}</span>
              </div>
              {i < steps.length - 1 && (
                <ChevronRight
                  className={cn(
                    "w-4 h-4 mx-1",
                    i < currentStepIndex
                      ? "text-anthracite"
                      : "text-muted-foreground"
                  )}
                />
              )}
            </div>
          ))}
        </div>

        {/* Step content */}
        <div className="max-w-5xl mx-auto">
          {step === "upload" && (
            <ImageUploader
              uploadedImage={uploadedImage}
              onImageUpload={handleImageUpload}
              onClear={handleClearImage}
            />
          )}

          {(step === "processing-depth" || step === "processing-walls") && (
            <div className="flex flex-col items-center justify-center p-12 space-y-6">
              <div className="relative">
                <Wand2 className="w-16 h-16 text-anthracite animate-pulse" />
              </div>
              <div className="text-center space-y-2">
                <h3 className="text-xl font-semibold text-foreground">
                  {step === "processing-depth"
                    ? "Analyzing Image Depth"
                    : "Detecting Walls"}
                </h3>
                <p className="text-muted-foreground text-sm">
                  {loadingStatus || "Processing..."}
                </p>
              </div>
              <div className="w-full max-w-xs">
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-anthracite transition-all duration-300 ease-out"
                    style={{ width: `${loadingProgress}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground text-center mt-2">
                  {Math.round(loadingProgress)}%
                </p>
              </div>
              <p className="text-xs text-muted-foreground max-w-md text-center">
                First-time loading may take longer as the AI models are
                downloaded. They will be cached for future use.
              </p>
            </div>
          )}

          {step === "place-panel" && uploadedImage && (
            <div className="space-y-6">
              {/* Controls bar */}
              <div className="flex items-center justify-between flex-wrap gap-3 p-4 bg-surface-elevated rounded-xl shadow-soft">
                <div className="flex items-center gap-2">
                  <div
                    className={cn(
                      "flex items-center gap-2 px-3 py-1.5 rounded-full text-sm",
                      selectedPanel
                        ? isOnWall
                          ? "bg-green-100 text-green-700"
                          : "bg-muted text-muted-foreground"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    <Move className="w-4 h-4" />
                    <span>
                      {selectedPanel
                        ? isOnWall
                          ? "On wall"
                          : "Drag to position"
                        : "Select a panel"}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {selectedPanel && (
                    <>
                      <Button
                        variant="minimal"
                        size="sm"
                        onClick={handleScaleDown}
                      >
                        <ZoomOut className="w-4 h-4" />
                      </Button>
                      <span className="text-sm text-muted-foreground min-w-[3rem] text-center">
                        {Math.round(panelTransform.scale * 100)}%
                      </span>
                      <Button
                        variant="minimal"
                        size="sm"
                        onClick={handleScaleUp}
                      >
                        <ZoomIn className="w-4 h-4" />
                      </Button>
                      <div className="w-px h-6 bg-border mx-2" />
                      <Button
                        variant="minimal"
                        size="sm"
                        onClick={handleSnapToWall}
                        disabled={!wallSegmentation?.detectedRectangles?.length}
                        title="Snap panel to detected wall area"
                      >
                        <Crosshair className="w-4 h-4 mr-1" />
                        Snap
                      </Button>
                      <Button
                        variant="minimal"
                        size="sm"
                        onClick={handleResetTransform}
                      >
                        <RotateCcw className="w-4 h-4 mr-1" />
                        Reset
                      </Button>
                      <div className="w-px h-6 bg-border mx-2" />
                      <Button
                        variant="hero"
                        size="sm"
                        onClick={handleDownload}
                        disabled={isProcessing}
                        title="Download visualization"
                      >
                        {isProcessing ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <>
                            <Download className="w-4 h-4 mr-1" />
                            <span className="hidden sm:inline">Download</span>
                          </>
                        )}
                      </Button>
                    </>
                  )}
                  <Button variant="minimal" size="sm" onClick={handleReset}>
                    New Photo
                  </Button>
                </div>
              </div>

              {/* Main visualization area */}
              <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                {/* Image with draggable panel overlay */}
                <div className="lg:col-span-3">
                  <div
                    ref={containerRef}
                    className="relative rounded-2xl overflow-hidden bg-muted shadow-medium select-none w-fit mx-auto"
                    style={{ perspective: "1200px" }}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={handleMouseUp}
                    onTouchMove={handleTouchMove}
                    onTouchEnd={handleTouchEnd}
                  >
                    {/* Background image */}
                    <img
                      src={uploadedImage}
                      alt="Room"
                      className="max-h-[75vh] w-auto max-w-full h-auto block"
                      draggable={false}
                      ref={(el) => {
                        imageRef.current = el;
                      }}
                      onLoad={(e) => {
                        const img = e.target as HTMLImageElement;
                        imageDimensions.current = {
                          width: img.clientWidth,
                          height: img.clientHeight,
                        };
                      }}
                    />

                    {/* Wall mask overlay for visualization (semi-transparent) */}
                    {wallSegmentation && wallSegmentation.wallMaskUrl && (
                      <img
                        src={wallSegmentation.wallMaskUrl}
                        alt="Wall mask"
                        className="absolute inset-0 w-full h-full object-cover pointer-events-none opacity-0"
                      />
                    )}

                    {/* Draggable panel overlay */}
                    {selectedPanel && panelDimensions.loaded && (
                      <div
                        className="absolute inset-0 pointer-events-none overflow-hidden"
                      >
                        <div
                          className={cn(
                            "absolute origin-center transition-transform pointer-events-auto",
                            isDragging ? "cursor-grabbing" : "cursor-grab"
                          )}
                          style={{
                            left: panelTransform.x,
                            top: panelTransform.y,
                            width: scaledPanelWidth,
                            height: scaledPanelHeight,
                            transform: `rotateX(${panelRotation.rotateX}deg) rotateY(${panelRotation.rotateY}deg)`,
                            transformStyle: "preserve-3d",
                            transitionDuration: isDragging ? "0ms" : "300ms",
                            filter: `drop-shadow(${-panelRotation.rotateY * 0.5
                              }px ${panelRotation.rotateX * 0.5 + 8
                              }px 12px rgba(0,0,0,0.4))`,
                          }}
                          onMouseDown={handleMouseDown}
                          onTouchStart={handleTouchStart}
                        >
                          <img
                            src={selectedPanel.textureUrl}
                            alt={selectedPanel.name}
                            className="w-full h-full object-contain pointer-events-none"
                            draggable={false}
                            style={{
                              filter: `brightness(${1 - depthAtPanel * 0.15})`,
                            }}
                          />

                          {/* Hover indicator */}
                          {!isDragging && (
                            <>
                              <div className="absolute inset-0 border-2 border-transparent group-hover:border-white/40 rounded transition-colors duration-200 pointer-events-none" />
                              <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none">
                                <div className="bg-black/50 text-white px-3 py-1 rounded-full text-sm flex items-center gap-1">
                                  <Move className="w-4 h-4" />
                                  Drag to move
                                </div>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Foreground overlay - shows non-wall objects ON TOP of the panel */}
                    {/* Uses depth-enhanced mask for better precision, falls back to segmentation-only */}
                    {selectedPanel && (enhancedForegroundMaskUrl || wallSegmentation?.foregroundMaskUrl) && (
                      <img
                        src={uploadedImage}
                        alt="Foreground"
                        className="absolute top-0 left-0 max-h-[75vh] w-auto max-w-full h-auto pointer-events-none"
                        draggable={false}
                        style={{
                          WebkitMaskImage: `url(${enhancedForegroundMaskUrl || wallSegmentation?.foregroundMaskUrl})`,
                          maskImage: `url(${enhancedForegroundMaskUrl || wallSegmentation?.foregroundMaskUrl})`,
                          WebkitMaskSize: '100% 100%',
                          maskSize: '100% 100%',
                          WebkitMaskRepeat: 'no-repeat',
                          maskRepeat: 'no-repeat',
                          WebkitMaskMode: 'luminance',
                          maskMode: 'luminance',
                        }}
                      />
                    )}

                    {/* Depth mask canvas for composite generation */}
                    <canvas
                      ref={canvasRef}
                      className="absolute inset-0 pointer-events-none opacity-0"
                    />

                    {/* Instruction overlay when no panel selected */}
                    {!selectedPanel && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                        <div className="text-center text-white p-6 rounded-xl bg-black/50 backdrop-blur-sm">
                          <ArrowRight className="w-8 h-8 mx-auto mb-2 animate-pulse" />
                          <p className="text-lg font-medium">
                            Select a panel from the right
                          </p>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Transform info */}
                  {selectedPanel && (
                    <div className="mt-3 flex items-center justify-center gap-4 text-xs text-muted-foreground">
                      <span>Tilt X: {panelRotation.rotateX.toFixed(1)}°</span>
                      <span>Tilt Y: {panelRotation.rotateY.toFixed(1)}°</span>
                      <span>
                        Scale: {(panelTransform.scale * 100).toFixed(0)}%
                      </span>
                      <span>Depth: {(depthAtPanel * 100).toFixed(0)}%</span>
                      <span>Size: {(clampedDepthScale * 100).toFixed(0)}%</span>
                    </div>
                  )}
                </div>



                {/* Mobile Panel Selector (below image) */}
                <div className="block lg:hidden mt-6">
                  <PanelSelector
                    selectedPanel={selectedPanel}
                    onSelect={handleSelectPanel}
                    compact={false}
                  />
                </div>

                {/* Panel selector sidebar (Desktop) */}
                <div className="hidden lg:block lg:col-span-1">
                  <div className="sticky top-4">
                    <PanelSelector
                      selectedPanel={selectedPanel}
                      onSelect={handleSelectPanel}
                      compact
                    />

                    {/* Depth map preview */}
                    {depthMap && (
                      <details className="mt-6">
                        <summary className="text-sm text-muted-foreground cursor-pointer hover:text-foreground">
                          Show depth map
                        </summary>
                        <div className="mt-2 rounded-lg overflow-hidden border border-border">
                          <img
                            src={depthMap.depthImageUrl}
                            alt="Depth map"
                            className="w-full h-auto opacity-80"
                          />
                        </div>
                      </details>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </section >
  );
}
