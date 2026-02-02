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
  Split,
  GripVertical,
  Grid3X3,
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
  calculateWallOrientationFromMask,
  calculatePerspectiveTransformMatrix,
  getRectanglePixelCorners,
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
  const [enhancedForegroundMaskUrl, setEnhancedForegroundMaskUrl] = useState<
    string | null
  >(null);

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
    null,
  );
  const [depthAtPanel, setDepthAtPanel] = useState<number>(0.5);
  const [isOnWall, setIsOnWall] = useState<boolean>(false);

  // Compare mode state
  const [showCompareMode, setShowCompareMode] = useState(false);
  const [comparePos, setComparePos] = useState(50);
  const [isDraggingSlider, setIsDraggingSlider] = useState(false);

  // Fill mode state - tiles panel across the entire wall
  const [fillMode, setFillMode] = useState(false);

  // Selected wall index - tracks which wall the user clicked before selecting a panel
  const [selectedWallIndex, setSelectedWallIndex] = useState<number | null>(null);

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
          wallError,
        );
        setWallSegmentation(null);
      }

      setStep("place-panel");

      if (walls && walls.wallArea > 0) {
        toast.success(
          `Wall detection complete! ${(walls.wallArea * 100).toFixed(
            1,
          )}% of image is wall. Drag panel onto the wall.`,
        );
      } else {
        toast.info(
          "Ready! Drag panel to position. Wall detection unavailable.",
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
    setFillMode(false);
    setSelectedWallIndex(null);
    setStep("upload");
  }, []);

  // Calculate perspective and scale based on wall segmentation and depth
  const calculateWallAwarePerspective = useCallback(
    (
      centerX: number,
      centerY: number,
      panelWidth: number,
      panelHeight: number,
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
          normalizedY,
        );
      }

      // Use wall mask shape for rotation (primary method)
      // Depth is only used for sizing, not rotation
      if (wallSegmentation && wallSegmentation.wallMask.length > 0) {
        // Get rotation from wall mask shape analysis
        const maskOrientation = calculateWallOrientationFromMask(
          wallSegmentation.wallMask,
          wallSegmentation.width,
          wallSegmentation.height,
          normalizedX,
          normalizedY,
        );

        // Round to 1 decimal place to prevent micro-adjustments that cause wobbling
        return {
          rotateX: Math.round(Math.max(-30, Math.min(30, maskOrientation.rotateX)) * 10) / 10,
          rotateY: Math.round(Math.max(-40, Math.min(40, maskOrientation.rotateY)) * 10) / 10,
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
            (normalizedY - plane.centerY) ** 2,
          );
          if (dist < minDist) {
            minDist = dist;
            closest = plane;
          }
        }

        const rotateY = -closest.normalX * 35; // Inverted, reduced sensitivity
        const rotateX = -closest.normalY * 25; // Inverted, reduced sensitivity

        // Round to 1 decimal place to prevent micro-adjustments that cause wobbling
        return {
          rotateX: Math.round(Math.max(-30, Math.min(30, rotateX)) * 10) / 10,
          rotateY: Math.round(Math.max(-40, Math.min(40, rotateY)) * 10) / 10,
          scale: 1,
          onWall,
        };
      }

      // Final fallback: position-based perspective
      const relativeX = normalizedX - 0.5;
      const relativeY = normalizedY - 0.5;

      const rotateY = relativeX * 25; // Inverted, reduced sensitivity
      const rotateX = -relativeY * 20; // Inverted, reduced sensitivity

      // Round to 1 decimal place to prevent micro-adjustments that cause wobbling
      return {
        rotateX: Math.round(Math.max(-30, Math.min(30, rotateX)) * 10) / 10,
        rotateY: Math.round(Math.max(-40, Math.min(40, rotateY)) * 10) / 10,
        scale: 1,
        onWall: false,
      };
    },
    [wallSegmentation, depthMap],
  );

  // Separate state for rotation to avoid infinite loops
  const [panelRotation, setPanelRotation] = useState({
    rotateX: 0,
    rotateY: 0,
  });

  // Target wall corners for perspective warp (in pixel coordinates)
  // When set, panel will be warped to conform to these corners instead of just rotating
  const [targetWallCorners, setTargetWallCorners] = useState<{ x: number; y: number }[] | null>(null);

  // Calculate base panel size based on wall bounding box for proper scaling
  const getBasePanelSize = useCallback(() => {
    if (!containerRef.current) return { width: 150, height: 300 };

    const container = containerRef.current;
    const rect = container.getBoundingClientRect();
    const panelAspectRatio = panelDimensions.loaded
      ? panelDimensions.width / panelDimensions.height
      : 0.5;

    // If we have wall segmentation, size panel to fill the largest wall while maintaining aspect ratio
    if (wallSegmentation && wallSegmentation.wallPlanes.length > 0) {
      // Find the largest wall plane
      const largestWall = wallSegmentation.wallPlanes.reduce(
        (largest, plane) => (plane.area > largest.area ? plane : largest),
        wallSegmentation.wallPlanes[0],
      );

      // Use the bounding box of the largest wall
      const wallBox = largestWall.boundingBox;
      const wallWidthPx = (wallBox.xmax - wallBox.xmin) * rect.width;
      const wallHeightPx = (wallBox.ymax - wallBox.ymin) * rect.height;
      const wallAspectRatio = wallWidthPx / wallHeightPx;

      // Fit panel to fill wall while maintaining aspect ratio ("contain" logic)
      let targetHeight, targetWidth;

      if (panelAspectRatio > wallAspectRatio) {
        // Panel is wider than wall - constrain by width
        targetWidth = wallWidthPx;
        targetHeight = targetWidth / panelAspectRatio;
      } else {
        // Panel is taller than wall - constrain by height
        targetHeight = wallHeightPx;
        targetWidth = targetHeight * panelAspectRatio;
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
      const wallAspectRatio = wallWidthPx / wallHeightPx;

      // Fit panel to fill wall while maintaining aspect ratio
      let targetHeight, targetWidth;

      if (panelAspectRatio > wallAspectRatio) {
        // Panel is wider than wall - constrain by width
        targetWidth = wallWidthPx;
        targetHeight = targetWidth / panelAspectRatio;
      } else {
        // Panel is taller than wall - constrain by height
        targetHeight = wallHeightPx;
        targetWidth = targetHeight * panelAspectRatio;
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

    // Calculate panel dimensions locally to avoid dependency on values that change in this effect
    const localDepthScale = Math.max(
      0.6,
      Math.min(1.4, 0.6 + depthAtPanel * 0.8),
    );
    const localScaledPanelHeight =
      basePanelSize.height * panelTransform.scale * localDepthScale;
    const localScaledPanelWidth = localScaledPanelHeight * aspectRatio;

    // Calculate center of panel
    const centerX = panelTransform.x + localScaledPanelWidth / 2;
    const centerY = panelTransform.y + localScaledPanelHeight / 2;

    // Get wall-aware perspective using panel dimensions for depth gradient sampling
    const perspective = calculateWallAwarePerspective(
      centerX,
      centerY,
      localScaledPanelWidth,
      localScaledPanelHeight,
    );

    // Only update rotation if change is significant (threshold: 2 degrees)
    // This prevents micro-adjustments that cause wobbling
    const ROTATION_THRESHOLD = 2;
    setPanelRotation((prev) => {
      const rotateXDiff = Math.abs(perspective.rotateX - prev.rotateX);
      const rotateYDiff = Math.abs(perspective.rotateY - prev.rotateY);

      // Only update if at least one axis has a significant change
      if (
        rotateXDiff >= ROTATION_THRESHOLD ||
        rotateYDiff >= ROTATION_THRESHOLD
      ) {
        return {
          rotateX: perspective.rotateX,
          rotateY: perspective.rotateY,
        };
      }
      return prev;
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
      normalizedY,
    );

    // Only update depth if change is significant (threshold: 0.05) to prevent infinite loops
    const DEPTH_THRESHOLD = 0.05;
    setDepthAtPanel((prev) => {
      if (Math.abs(depth - prev) >= DEPTH_THRESHOLD) {
        return depth;
      }
      return prev;
    });
  }, [
    panelTransform.x,
    panelTransform.y,
    panelTransform.scale,
    depthMap,
    step,
    calculateWallAwarePerspective,
    basePanelSize.height,
    aspectRatio,
    depthAtPanel,
  ]);

  // Helper function to check if the panel would be fully within the wall mask at a given position
  const isPanelOnWall = useCallback(
    (panelX: number, panelY: number, panelW: number, panelH: number): boolean => {
      if (!wallSegmentation || wallSegmentation.wallMask.length === 0 || !containerRef.current) {
        return true; // No wall mask, allow all positions
      }

      const container = containerRef.current;
      const rect = container.getBoundingClientRect();
      const { wallMask, width, height } = wallSegmentation;

      // Check multiple points on the panel: center, corners, and edge midpoints
      const pointsToCheck = [
        // Center
        { x: panelX + panelW / 2, y: panelY + panelH / 2 },
        // Corners (slightly inset to avoid edge detection issues)
        { x: panelX + panelW * 0.1, y: panelY + panelH * 0.1 },
        { x: panelX + panelW * 0.9, y: panelY + panelH * 0.1 },
        { x: panelX + panelW * 0.9, y: panelY + panelH * 0.9 },
        { x: panelX + panelW * 0.1, y: panelY + panelH * 0.9 },
        // Edge midpoints
        { x: panelX + panelW / 2, y: panelY + panelH * 0.1 },
        { x: panelX + panelW / 2, y: panelY + panelH * 0.9 },
        { x: panelX + panelW * 0.1, y: panelY + panelH / 2 },
        { x: panelX + panelW * 0.9, y: panelY + panelH / 2 },
      ];

      // Check if ALL points are on the wall
      for (const point of pointsToCheck) {
        const normalizedX = point.x / rect.width;
        const normalizedY = point.y / rect.height;

        // Skip points outside the image bounds
        if (normalizedX < 0 || normalizedX > 1 || normalizedY < 0 || normalizedY > 1) {
          return false; // Point is outside image, not on wall
        }

        if (!isPointOnWall(wallMask, width, height, normalizedX, normalizedY)) {
          return false; // At least one point is not on wall
        }
      }

      return true; // All points are on wall
    },
    [wallSegmentation],
  );

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
    [selectedPanel, panelTransform.x, panelTransform.y],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging || !dragStart) return;

      const newX = e.clientX - dragStart.x;
      const newY = e.clientY - dragStart.y;

      // Constrain panel to wall boundaries if wall segmentation is available
      if (
        wallSegmentation &&
        wallSegmentation.wallMask.length > 0 &&
        containerRef.current
      ) {
        // Check if the entire panel would be on the wall at the new position
        const wouldBeOnWall = isPanelOnWall(newX, newY, scaledPanelWidth, scaledPanelHeight);

        // Check if currently on wall
        const currentlyOnWall = isPanelOnWall(
          panelTransform.x,
          panelTransform.y,
          scaledPanelWidth,
          scaledPanelHeight,
        );

        // Block movement if:
        // - Currently on wall AND new position would not be fully on wall
        // Allow movement if:
        // - Moving TO a fully on-wall position (always allowed)
        // - Currently NOT fully on wall (allow escape from stuck positions)
        if (!wouldBeOnWall && currentlyOnWall) {
          // Block movement from wall to non-wall
          return;
        }
      }

      setPanelTransform((prev) => ({
        ...prev,
        x: newX,
        y: newY,
      }));
    },
    [
      isDragging,
      dragStart,
      wallSegmentation,
      scaledPanelWidth,
      scaledPanelHeight,
      panelTransform.x,
      panelTransform.y,
      isPanelOnWall,
    ],
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
    [selectedPanel, panelTransform.x, panelTransform.y],
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!isDragging || !dragStart) return;
      const touch = e.touches[0];

      const newX = touch.clientX - dragStart.x;
      const newY = touch.clientY - dragStart.y;

      // Constrain panel to wall boundaries if wall segmentation is available
      if (
        wallSegmentation &&
        wallSegmentation.wallMask.length > 0 &&
        containerRef.current
      ) {
        // Check if the entire panel would be on the wall at the new position
        const wouldBeOnWall = isPanelOnWall(newX, newY, scaledPanelWidth, scaledPanelHeight);

        // Check if currently on wall
        const currentlyOnWall = isPanelOnWall(
          panelTransform.x,
          panelTransform.y,
          scaledPanelWidth,
          scaledPanelHeight,
        );

        // Block movement if:
        // - Currently on wall AND new position would not be fully on wall
        // Allow movement if:
        // - Moving TO a fully on-wall position (always allowed)
        // - Currently NOT fully on wall (allow escape from stuck positions)
        if (!wouldBeOnWall && currentlyOnWall) {
          // Block movement from wall to non-wall
          return;
        }
      }

      setPanelTransform((prev) => ({
        ...prev,
        x: newX,
        y: newY,
      }));
    },
    [
      isDragging,
      dragStart,
      wallSegmentation,
      scaledPanelWidth,
      scaledPanelHeight,
      panelTransform.x,
      panelTransform.y,
      isPanelOnWall,
    ],
  );

  const handleTouchEnd = useCallback(() => {
    setIsDragging(false);
    setDragStart(null);
  }, []);

  // Handle slider drag (mouse)
  useEffect(() => {
    const handleGlobalMove = (e: MouseEvent) => {
      if (!isDraggingSlider || !containerRef.current) return;

      const container = containerRef.current;
      const rect = container.getBoundingClientRect();
      const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
      const pos = (x / rect.width) * 100;
      setComparePos(pos);
    };

    const handleGlobalUp = () => {
      setIsDraggingSlider(false);
    };

    if (isDraggingSlider) {
      window.addEventListener("mousemove", handleGlobalMove);
      window.addEventListener("mouseup", handleGlobalUp);
    }

    return () => {
      window.removeEventListener("mousemove", handleGlobalMove);
      window.removeEventListener("mouseup", handleGlobalUp);
    };
  }, [isDraggingSlider]);

  // Handle slider drag (touch)
  useEffect(() => {
    const handleGlobalTouchMove = (e: TouchEvent) => {
      if (!isDraggingSlider || !containerRef.current) return;

      const container = containerRef.current;
      const rect = container.getBoundingClientRect();
      // Handle touch coordinates
      const touch = e.touches[0];
      const x = Math.max(0, Math.min(rect.width, touch.clientX - rect.left));
      const pos = (x / rect.width) * 100;
      setComparePos(pos);
    };

    const handleGlobalTouchEnd = () => {
      setIsDraggingSlider(false);
    };

    if (isDraggingSlider) {
      window.addEventListener("touchmove", handleGlobalTouchMove, { passive: false });
      window.addEventListener("touchend", handleGlobalTouchEnd);
    }

    return () => {
      window.removeEventListener("touchmove", handleGlobalTouchMove);
      window.removeEventListener("touchend", handleGlobalTouchEnd);
    };
  }, [isDraggingSlider]);

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
    setTargetWallCorners(null); // Clear perspective warp
    setFillMode(false); // Exit fill mode
    setSelectedPanel(null); // Clear the selected panel
    setSelectedWallIndex(null); // Reset wall selection
  }, []);

  // Helper function to find a valid wall position within a rectangle (not on foreground)
  const findValidWallPosition = useCallback(
    (rect: {
      center: { x: number; y: number };
      boundingBox: { xmin: number; ymin: number; xmax: number; ymax: number };
    }) => {
      if (!wallSegmentation || wallSegmentation.wallMask.length === 0) {
        return rect.center; // Fall back to geometric center
      }

      const { wallMask, width, height } = wallSegmentation;

      // First check if the geometric center is on the wall
      if (
        isPointOnWall(wallMask, width, height, rect.center.x, rect.center.y)
      ) {
        return rect.center;
      }

      // Search for a valid wall point within the rectangle
      // Start from center and spiral outward
      const { xmin, ymin, xmax, ymax } = rect.boundingBox;
      const stepX = (xmax - xmin) / 10;
      const stepY = (ymax - ymin) / 10;

      // Try points in a grid pattern within the rectangle
      for (let dy = 0; dy <= 5; dy++) {
        for (let dx = 0; dx <= 5; dx++) {
          // Try 4 quadrants from center
          const offsets = [
            { x: dx * stepX, y: dy * stepY },
            { x: -dx * stepX, y: dy * stepY },
            { x: dx * stepX, y: -dy * stepY },
            { x: -dx * stepX, y: -dy * stepY },
          ];

          for (const offset of offsets) {
            const testX = Math.max(
              xmin + 0.05,
              Math.min(xmax - 0.05, rect.center.x + offset.x),
            );
            const testY = Math.max(
              ymin + 0.05,
              Math.min(ymax - 0.05, rect.center.y + offset.y),
            );

            if (isPointOnWall(wallMask, width, height, testX, testY)) {
              return { x: testX, y: testY };
            }
          }
        }
      }

      // If no valid point found, return the geometric center anyway
      return rect.center;
    },
    [wallSegmentation],
  );

  // Snap panel to a specific detected rectangle by index
  const handleSnapToRectangle = useCallback(
    (rectangleIndex: number, panelOverride?: WallPanel, dimensionsOverride?: PanelDimensions) => {
      // Use overrides or state
      const panel = panelOverride || selectedPanel;
      const dims = dimensionsOverride || panelDimensions;

      if (
        !wallSegmentation ||
        !containerRef.current ||
        !panel ||
        !dims.loaded
      ) {
        return;
      }

      // Use detectedRectangles if available, otherwise fallback to wallPlanes
      const rectangles =
        wallSegmentation.detectedRectangles?.length > 0
          ? wallSegmentation.detectedRectangles
          : wallSegmentation.wallPlanes?.map((plane) => {
            const width = plane.boundingBox.xmax - plane.boundingBox.xmin;
            const height = plane.boundingBox.ymax - plane.boundingBox.ymin;
            return {
              center: { x: plane.centerX, y: plane.centerY },
              boundingBox: plane.boundingBox,
              width,
              height,
              area: plane.area,
              aspectRatio: width / height,
              corners: [
                { x: plane.boundingBox.xmin, y: plane.boundingBox.ymin },
                { x: plane.boundingBox.xmax, y: plane.boundingBox.ymin },
                { x: plane.boundingBox.xmax, y: plane.boundingBox.ymax },
                { x: plane.boundingBox.xmin, y: plane.boundingBox.ymax },
              ],
            };
          }) || [];

      if (!rectangles || rectangleIndex >= rectangles.length) {
        return;
      }

      const container = containerRef.current;
      const rect = container.getBoundingClientRect();
      const targetRect = rectangles[rectangleIndex];

      // Calculate panel aspect ratio
      const panelAspectRatio = dims.width / dims.height;
      const wallAspectRatio = targetRect.width / targetRect.height;

      // Calculate wall dimensions in pixels
      const wallWidthPx = targetRect.width * rect.width;
      const wallHeightPx = targetRect.height * rect.height;

      // Fit panel to fill the wall while maintaining aspect ratio
      // Use "contain" logic: maximize size while staying within wall bounds
      let targetWidth: number;
      let targetHeight: number;

      if (panelAspectRatio > wallAspectRatio) {
        // Panel is wider than wall - constrain by width
        targetWidth = wallWidthPx;
        targetHeight = targetWidth / panelAspectRatio;
      } else {
        // Panel is taller than wall - constrain by height
        targetHeight = wallHeightPx;
        targetWidth = targetHeight * panelAspectRatio;
      }

      // Center the panel within the wall rectangle
      const rectLeft = targetRect.boundingBox.xmin * rect.width;
      const rectTop = targetRect.boundingBox.ymin * rect.height;
      const offsetX = (wallWidthPx - targetWidth) / 2;
      const offsetY = (wallHeightPx - targetHeight) / 2;

      const targetX = rectLeft + offsetX;
      const targetY = rectTop + offsetY;

      // Calculate depth at the target center position to get accurate depth scale
      const targetCenterX = targetX + targetWidth / 2;
      const targetCenterY = targetY + targetHeight / 2;
      const normalizedX = Math.max(0, Math.min(1, targetCenterX / rect.width));
      const normalizedY = Math.max(0, Math.min(1, targetCenterY / rect.height));

      let targetDepth = 0.5;
      let targetDepthScale = 1.0;
      if (depthMap) {
        targetDepth = sampleDepthAt(
          depthMap.depthData,
          depthMap.width,
          depthMap.height,
          normalizedX,
          normalizedY,
        );
        const targetDepthFactor = 0.6 + targetDepth * 0.8;
        targetDepthScale = Math.max(0.6, Math.min(1.4, targetDepthFactor));
      }

      // Set depthAtPanel FIRST so the scale calculation matches the render
      setDepthAtPanel(targetDepth);

      // Calculate the scale needed to achieve target height
      // The rendered size is: basePanelSize.height * scale * depthScale
      // We want: targetHeight = basePanelSize.height * newScale * targetDepthScale
      // So: newScale = targetHeight / (basePanelSize.height * targetDepthScale)

      // IMPORTANT: When using overrides (during initial selection), getBasePanelSize() 
      // might return values based on OLD state (e.g. previous panel loaded state).
      // We should calculate base size locally if specific dimensions are provided.
      let baseSizeHeight = 250;

      if (dims.loaded) {
        // Re-calculate base size logic locally to ensure it uses the correct aspect ratio
        // This duplicates some logic from getBasePanelSize but ensures correctness with overrides
        const panelAspectRatio = dims.width / dims.height;

        if (wallSegmentation) {
          // Compute what getBasePanelSize WOULD return for this panel
          const largestWall = wallSegmentation.wallPlanes.reduce(
            (largest, plane) => (plane.area > largest.area ? plane : largest),
            wallSegmentation.wallPlanes[0],
          );
          if (largestWall) {
            const wallBox = largestWall.boundingBox;
            const wallWidthPx = (wallBox.xmax - wallBox.xmin) * rect.width;
            const wallHeightPx = (wallBox.ymax - wallBox.ymin) * rect.height;
            const wallAspectRatio = wallWidthPx / wallHeightPx;

            // Fit panel to fill wall while maintaining aspect ratio
            let targetHeight, targetWidth;
            if (panelAspectRatio > wallAspectRatio) {
              targetWidth = wallWidthPx;
              targetHeight = targetWidth / panelAspectRatio;
            } else {
              targetHeight = wallHeightPx;
              targetWidth = targetHeight * panelAspectRatio;
            }
            baseSizeHeight = Math.max(150, targetHeight);
          }
        }
      } else {
        // Fallback to hook if no override (standard behavior)
        baseSizeHeight = getBasePanelSize().height;
      }

      const newScale = targetHeight / (baseSizeHeight * targetDepthScale);

      setPanelTransform({
        x: targetX,
        y: targetY,
        scale: Math.max(0.3, Math.min(5, newScale)),
      });

      // Clear any existing wall corner warp - panel should maintain its aspect ratio
      // and not be warped to fill the wall shape
      setTargetWallCorners(null);

      // Update rotation based on wall plane (for subtle perspective effect)
      const perspective = calculateWallAwarePerspective(
        targetX + targetWidth / 2,
        targetY + targetHeight / 2,
        targetWidth,
        targetHeight,
      );
      setPanelRotation({
        rotateX: perspective.rotateX,
        rotateY: perspective.rotateY,
      });

      if (!panelOverride) {
        toast.success(`Panel placed on wall ${rectangleIndex + 1}!`);
      }
    },
    [
      wallSegmentation,
      selectedPanel,
      panelDimensions,
      calculateWallAwarePerspective,
      depthMap,
      getBasePanelSize,
    ],
  );

  // Snap panel to best detected rectangle
  const handleSnapToWall = useCallback(() => {
    if (
      !wallSegmentation ||
      !containerRef.current ||
      !selectedPanel ||
      !panelDimensions.loaded
    ) {
      toast.error("No wall rectangles detected");
      return;
    }

    // Use detectedRectangles if available, otherwise fallback to wallPlanes
    const rectangles =
      wallSegmentation.detectedRectangles?.length > 0
        ? wallSegmentation.detectedRectangles
        : wallSegmentation.wallPlanes?.map((plane) => {
          const width = plane.boundingBox.xmax - plane.boundingBox.xmin;
          const height = plane.boundingBox.ymax - plane.boundingBox.ymin;
          return {
            center: { x: plane.centerX, y: plane.centerY },
            boundingBox: plane.boundingBox,
            width,
            height,
            area: plane.area,
            aspectRatio: width / height,
            corners: [
              { x: plane.boundingBox.xmin, y: plane.boundingBox.ymin },
              { x: plane.boundingBox.xmax, y: plane.boundingBox.ymin },
              { x: plane.boundingBox.xmax, y: plane.boundingBox.ymax },
              { x: plane.boundingBox.xmin, y: plane.boundingBox.ymax },
            ],
          };
        }) || [];

    if (!rectangles || rectangles.length === 0) {
      toast.error("No rectangular wall areas detected");
      return;
    }

    console.log(
      `[Visualizer] handleSnapToWall: Using ${rectangles.length} rectangles`,
    );

    const container = containerRef.current;
    const rect = container.getBoundingClientRect();

    // Calculate panel aspect ratio
    const panelAspectRatio = panelDimensions.width / panelDimensions.height;

    // Find the best rectangle for this panel
    const bestRect = findBestRectangleForPanel(
      rectangles,
      panelAspectRatio,
      0.01,
    );

    if (!bestRect) {
      toast.error("No suitable wall area found");
      return;
    }

    console.log("[Snap] Best rectangle:", bestRect);
    console.log("[Snap] Container size:", rect.width, rect.height);

    // Calculate target dimensions in pixels - fit panel to fill wall while maintaining aspect ratio
    const wallWidthPx = bestRect.width * rect.width;
    const wallHeightPx = bestRect.height * rect.height;
    const wallAspectRatio = wallWidthPx / wallHeightPx;

    let targetWidth: number;
    let targetHeight: number;

    // Fit panel to fill wall while maintaining aspect ratio ("contain" logic)
    if (panelAspectRatio > wallAspectRatio) {
      // Panel is wider than wall - constrain by width
      targetWidth = wallWidthPx;
      targetHeight = targetWidth / panelAspectRatio;
    } else {
      // Panel is taller than wall - constrain by height
      targetHeight = wallHeightPx;
      targetWidth = targetHeight * panelAspectRatio;
    }

    // Calculate position (centered in wall rectangle)
    const rectLeft = bestRect.boundingBox.xmin * rect.width;
    const rectTop = bestRect.boundingBox.ymin * rect.height;
    const offsetX = (wallWidthPx - targetWidth) / 2;
    const offsetY = (wallHeightPx - targetHeight) / 2;

    const targetX = rectLeft + offsetX;
    const targetY = rectTop + offsetY;

    console.log("[Snap] Target position:", targetX, targetY);
    console.log("[Snap] Target size:", targetWidth, targetHeight);

    // Calculate depth at the target center position to get accurate depth scale
    const targetCenterX = targetX + targetWidth / 2;
    const targetCenterY = targetY + targetHeight / 2;
    const normalizedX = Math.max(0, Math.min(1, targetCenterX / rect.width));
    const normalizedY = Math.max(0, Math.min(1, targetCenterY / rect.height));

    let targetDepth = 0.5;
    let targetDepthScale = 1.0;
    if (depthMap) {
      targetDepth = sampleDepthAt(
        depthMap.depthData,
        depthMap.width,
        depthMap.height,
        normalizedX,
        normalizedY,
      );
      const targetDepthFactor = 0.6 + targetDepth * 0.8;
      targetDepthScale = Math.max(0.6, Math.min(1.4, targetDepthFactor));
    }

    // Set depthAtPanel FIRST so the scale calculation matches the render
    setDepthAtPanel(targetDepth);

    // Calculate the scale needed to achieve target height
    // scaledPanelHeight = basePanelSize.height * scale * depthScale
    // We need: targetHeight = basePanelSize.height * newScale * targetDepthScale
    const baseSize = getBasePanelSize();
    const newScale = targetHeight / (baseSize.height * targetDepthScale);

    console.log("[Snap] Base size:", baseSize);
    console.log("[Snap] Depth scale:", targetDepthScale);
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
      targetHeight,
    );
    setPanelRotation({
      rotateX: perspective.rotateX,
      rotateY: perspective.rotateY,
    });

    toast.success("Panel snapped to wall!");
  }, [
    wallSegmentation,
    selectedPanel,
    panelDimensions,
    calculateWallAwarePerspective,
    depthMap,
    getBasePanelSize,
  ]);

  // Helper function to find nearest wall point from any position (normalized coords)
  const findNearestWallPoint = useCallback(
    (
      normalizedX: number,
      normalizedY: number,
      searchRadius: number = 0.3,
    ): { x: number; y: number } | null => {
      if (!wallSegmentation || wallSegmentation.wallMask.length === 0) {
        return null;
      }

      const { wallMask, width, height } = wallSegmentation;

      // First check if already on wall
      if (isPointOnWall(wallMask, width, height, normalizedX, normalizedY)) {
        return { x: normalizedX, y: normalizedY };
      }

      // Search in a spiral pattern from the starting point
      const steps = 20;
      for (let radius = 0.02; radius <= searchRadius; radius += 0.02) {
        for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / steps) {
          const testX = Math.max(
            0,
            Math.min(1, normalizedX + Math.cos(angle) * radius),
          );
          const testY = Math.max(
            0,
            Math.min(1, normalizedY + Math.sin(angle) * radius),
          );

          if (isPointOnWall(wallMask, width, height, testX, testY)) {
            return { x: testX, y: testY };
          }
        }
      }

      return null;
    },
    [wallSegmentation],
  );

  const handleSelectPanel = useCallback(
    (panel: WallPanel) => {
      setSelectedPanel(panel);

      // Determine which wall to place on: use selectedWallIndex if set, otherwise default to wall 0
      const targetWallIndex = selectedWallIndex ?? 0;

      // If we have wall segmentation, position panel on the target wall
      if (
        wallSegmentation &&
        containerRef.current &&
        ((wallSegmentation.detectedRectangles && wallSegmentation.detectedRectangles.length > 0) ||
          (wallSegmentation.wallPlanes && wallSegmentation.wallPlanes.length > 0))
      ) {
        // Use logic from handleSnapToRectangle, but we must first load the image to get dimensions
        // to pass as overrides, since state hasn't updated yet.
        const img = new Image();
        img.onload = () => {
          const dims: PanelDimensions = {
            width: img.naturalWidth,
            height: img.naturalHeight,
            loaded: true
          };
          // Snap to target wall using this panel and these dimensions
          handleSnapToRectangle(targetWallIndex, panel, dims);
          toast.success(`${panel.name} placed on Wall ${targetWallIndex + 1}!`);
          // Clear the selected wall index after placing
          setSelectedWallIndex(null);
        };
        img.src = panel.textureUrl;
        return;
      }

      // Fallback for no walls detected or other cases
      if (
        wallSegmentation &&
        wallSegmentation.wallBoundingBox &&
        containerRef.current
      ) {
        // Fallback: use wall bounding box center
        const container = containerRef.current;
        const rect = container.getBoundingClientRect();
        const box = wallSegmentation.wallBoundingBox;

        let normalizedCenterX = (box.xmin + box.xmax) / 2;
        let normalizedCenterY = (box.ymin + box.ymax) / 2;

        const centerX = normalizedCenterX * rect.width;
        const centerY = normalizedCenterY * rect.height;

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
          `${panel.name} selected! Drag it to position on your wall.`,
        );
      }
    },
    [wallSegmentation, handleSnapToRectangle, selectedWallIndex],
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

      // Load images first to get original dimensions
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

      // Use original image dimensions for high-quality export
      canvas.width = bgImg.naturalWidth;
      canvas.height = bgImg.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        throw new Error("Failed to get canvas context");
      }

      // Calculate scale factor between display and original image
      const scaleX = bgImg.naturalWidth / rect.width;
      const scaleY = bgImg.naturalHeight / rect.height;

      // Draw background at full resolution
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
                step * maskScaleY,
              );
            }
          }
        }
        ctx.clip();
      }

      // Save context state for panel transform
      ctx.save();

      // Scale panel position and size to match original image dimensions
      const scaledPanelX = panelTransform.x * scaleX;
      const scaledPanelY = panelTransform.y * scaleY;
      const fullResPanelWidth = scaledPanelWidth * scaleX;
      const fullResPanelHeight = scaledPanelHeight * scaleY;

      // Move to panel center (scaled to full resolution)
      const centerX = scaledPanelX + fullResPanelWidth / 2;
      const centerY = scaledPanelY + fullResPanelHeight / 2;
      ctx.translate(centerX, centerY);

      // Apply rotation (convert deg to rad)
      const rotXRad = (panelRotation.rotateX * Math.PI) / 180;
      const rotYRad = (panelRotation.rotateY * Math.PI) / 180;

      // Approximate 3D rotation with 2D skew
      const skewX = Math.tan(rotYRad) * 0.3;
      const skewY = Math.tan(rotXRad) * 0.3;
      ctx.transform(1, skewY, skewX, 1, 0, 0);

      // Draw panel centered at full resolution
      ctx.drawImage(
        panelImg,
        -fullResPanelWidth / 2,
        -fullResPanelHeight / 2,
        fullResPanelWidth,
        fullResPanelHeight,
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
        const fgImageData = fgCtx.getImageData(
          0,
          0,
          canvas.width,
          canvas.height,
        );
        const mainImageData = ctx.getImageData(
          0,
          0,
          canvas.width,
          canvas.height,
        );

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

  // Toggle fill mode - tiles panel across the entire wall
  const handleFillWall = useCallback(() => {
    if (!wallSegmentation || !wallSegmentation.cssMaskUrl) {
      toast.error("No wall detected to fill");
      return;
    }
    if (!selectedPanel) {
      toast.error("Please select a panel first");
      return;
    }
    
    setFillMode(prev => {
      const newMode = !prev;
      if (newMode) {
        toast.success("Fill mode enabled - panel tiles across wall");
      } else {
        toast.info("Fill mode disabled");
      }
      return newMode;
    });
  }, [wallSegmentation, selectedPanel]);

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
                    : "bg-muted text-muted-foreground",
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
                      : "text-muted-foreground",
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
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-3 sm:p-4 bg-surface-elevated rounded-xl shadow-soft">
                {/* Status indicator */}
                <div className="flex items-center justify-center sm:justify-start">
                  <div
                    className={cn(
                      "flex items-center gap-2 px-3 py-2 sm:py-1.5 rounded-full text-sm font-medium",
                      selectedPanel
                        ? isOnWall
                          ? "bg-green-100 text-green-700"
                          : "bg-muted text-muted-foreground"
                        : "bg-muted text-muted-foreground",
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

                {/* Control buttons */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                  {selectedPanel && (
                    <>
                      {/* Zoom controls */}
                      <div className="flex items-center justify-center gap-2">
                        <Button
                          variant="minimal"
                          size="sm"
                          onClick={handleScaleDown}
                          className="min-h-[44px] sm:min-h-0 flex-1 sm:flex-initial"
                        >
                          <ZoomOut className="w-4 h-4" />
                        </Button>
                        <span className="text-sm text-muted-foreground min-w-[3rem] text-center font-medium">
                          {Math.round(panelTransform.scale * 100)}%
                        </span>
                        <Button
                          variant="minimal"
                          size="sm"
                          onClick={handleScaleUp}
                          className="min-h-[44px] sm:min-h-0 flex-1 sm:flex-initial"
                        >
                          <ZoomIn className="w-4 h-4" />
                        </Button>
                      </div>

                      {/* Divider - hidden on mobile */}
                      <div className="hidden sm:block w-px h-6 bg-border mx-1" />

                      {/* Panel controls */}
                      <div className="grid grid-cols-3 sm:flex sm:items-center gap-2">
                        <Button
                          variant="minimal"
                          size="sm"
                          onClick={handleSnapToWall}
                          disabled={!wallSegmentation?.detectedRectangles?.length}
                          title="Snap panel to detected wall area"
                          className="min-h-[44px] sm:min-h-0"
                        >
                          <Crosshair className="w-4 h-4 sm:mr-1" />
                          <span className="hidden xs:inline sm:inline">Snap</span>
                        </Button>
                        <Button
                          variant={fillMode ? "default" : "minimal"}
                          size="sm"
                          onClick={handleFillWall}
                          disabled={!wallSegmentation?.cssMaskUrl}
                          title="Fill entire wall with tiled panel pattern"
                          className="min-h-[44px] sm:min-h-0"
                        >
                          <Grid3X3 className="w-4 h-4 sm:mr-1" />
                          <span className="hidden xs:inline sm:inline">Fill</span>
                        </Button>
                        <Button
                          variant="minimal"
                          size="sm"
                          onClick={handleResetTransform}
                          className="min-h-[44px] sm:min-h-0"
                        >
                          <RotateCcw className="w-4 h-4 sm:mr-1" />
                          <span className="hidden xs:inline sm:inline">Reset</span>
                        </Button>
                      </div>

                      {/* Divider - hidden on mobile */}
                      <div className="hidden sm:block w-px h-6 bg-border mx-1" />

                      {/* Download button */}
                      <Button
                        variant="hero"
                        size="sm"
                        onClick={handleDownload}
                        disabled={isProcessing}
                        title="Download visualization"
                        className="min-h-[44px] sm:min-h-0"
                      >
                        {isProcessing ? (
                          <Loader2 className="w-4 h-4 animate-spin mr-2" />
                        ) : (
                          <Download className="w-4 h-4 mr-2" />
                        )}
                        Download
                      </Button>
                    </>
                  )}

                  {/* Divider - hidden on mobile, shown only when panel is selected */}
                  {selectedPanel && <div className="hidden sm:block w-px h-6 bg-border mx-1" />}

                  {/* Secondary controls */}
                  <div className="grid grid-cols-2 sm:flex sm:items-center gap-2">
                    <Button 
                      variant="minimal" 
                      size="sm" 
                      onClick={handleReset}
                      className="min-h-[44px] sm:min-h-0"
                    >
                      New Photo
                    </Button>
                    <Button
                      variant={showCompareMode ? "default" : "minimal"}
                      size="sm"
                      onClick={() => setShowCompareMode(!showCompareMode)}
                      title="Toggle Before/After comparison"
                      className="min-h-[44px] sm:min-h-0"
                    >
                      <Split className="w-4 h-4 mr-2" />
                      Compare
                    </Button>
                  </div>
                </div>
              </div>

              {/* Main visualization area */}
              <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                {/* Image with draggable panel overlay */}
                <div className="lg:col-span-3">
                  <div
                    ref={containerRef}
                    className="relative rounded-2xl overflow-hidden bg-muted shadow-medium select-none w-fit mx-auto"
                    style={{
                      perspective: "1200px",
                      // Prevent scroll interference on touch devices
                      touchAction: selectedPanel ? "none" : "auto",
                      // Ensure GPU acceleration for smoother transforms
                      willChange: "transform",
                    }}
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

                    {/* Comparison Wrapper - contains everything that is "After" state */}
                    <div
                      className="absolute inset-0 pointer-events-none"
                      style={{
                        clipPath: showCompareMode ? `inset(0 ${100 - comparePos}% 0 0)` : undefined,
                        // Ensure we don't block events to children
                      }}
                    >
                      {/* Wall mask overlay for visualization (semi-transparent) */}
                      {wallSegmentation && wallSegmentation.wallMaskUrl && (
                        <img
                          src={wallSegmentation.wallMaskUrl}
                          alt="Wall mask"
                          className="absolute inset-0 w-full h-full object-cover pointer-events-none opacity-0"
                        />
                      )}

                      {/* Wall selection buttons - show circle buttons at center of each detected wall */}
                      {wallSegmentation &&
                        (() => {
                          // Use detectedRectangles if available, otherwise fallback to wallPlanes
                          const rectangles =
                            wallSegmentation.detectedRectangles?.length > 0
                              ? wallSegmentation.detectedRectangles
                              : wallSegmentation.wallPlanes?.map((plane) => {
                                const width =
                                  plane.boundingBox.xmax -
                                  plane.boundingBox.xmin;
                                const height =
                                  plane.boundingBox.ymax -
                                  plane.boundingBox.ymin;
                                return {
                                  center: { x: plane.centerX, y: plane.centerY },
                                  boundingBox: plane.boundingBox,
                                  width,
                                  height,
                                  area: plane.area,
                                  aspectRatio: width / height,
                                  corners: [
                                    { x: plane.boundingBox.xmin, y: plane.boundingBox.ymin },
                                    { x: plane.boundingBox.xmax, y: plane.boundingBox.ymin },
                                    { x: plane.boundingBox.xmax, y: plane.boundingBox.ymax },
                                    { x: plane.boundingBox.xmin, y: plane.boundingBox.ymax },
                                  ],
                                };
                              }) || [];

                          console.log(
                            `[Visualizer] Wall buttons: ${rectangles.length} rectangles available`,
                          );

                          if (rectangles.length === 0) return null;

                          return (
                            <div className="absolute inset-0 pointer-events-none">
                              {rectangles.map((rect, index) => {
                                // Find a valid position on the wall (not blocked by foreground)
                                const validPos = findValidWallPosition(rect);
                                const isSelected = selectedWallIndex === index;
                                return (
                                  <button
                                    key={index}
                                    onClick={() => {
                                      if (selectedPanel) {
                                        // Panel already selected, snap to this wall
                                        handleSnapToRectangle(index);
                                      } else {
                                        // No panel yet, remember which wall was clicked
                                        setSelectedWallIndex(index);
                                        toast.info(`Wall ${index + 1} selected. Now choose a panel.`);
                                      }
                                    }}
                                    className={cn(
                                      "absolute w-10 h-10 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 shadow-lg pointer-events-auto transition-all duration-200 hover:scale-110 flex items-center justify-center text-sm font-semibold",
                                      isSelected
                                        ? "bg-green-500 hover:bg-green-600 text-white border-white scale-110"
                                        : "bg-anthracite/80 hover:bg-anthracite text-white border-white"
                                    )}
                                    style={{
                                      left: `${validPos.x * 100}%`,
                                      top: `${validPos.y * 100}%`,
                                    }}
                                    title={selectedPanel ? `Place panel on wall ${index + 1}` : `Select wall ${index + 1}`}
                                  >
                                    {index + 1}
                                  </button>
                                );
                              })}
                            </div>
                          );
                        })()}

                      {/* Tiled panel fill mode - tiles panel across entire wall mask */}
                      {selectedPanel && panelDimensions.loaded && fillMode && wallSegmentation?.cssMaskUrl && (
                        <div 
                          className="absolute inset-0 pointer-events-none"
                          style={{
                            WebkitMaskImage: `url(${wallSegmentation.cssMaskUrl})`,
                            maskImage: `url(${wallSegmentation.cssMaskUrl})`,
                            WebkitMaskSize: "100% 100%",
                            maskSize: "100% 100%",
                            WebkitMaskRepeat: "no-repeat",
                            maskRepeat: "no-repeat",
                          }}
                        >
                          <div 
                            className="w-full h-full"
                            style={{
                              backgroundImage: `url(${selectedPanel.textureUrl})`,
                              backgroundSize: `${scaledPanelWidth}px ${scaledPanelHeight}px`,
                              backgroundRepeat: "repeat",
                              filter: `brightness(${1 - depthAtPanel * 0.15})`,
                            }}
                          />
                        </div>
                      )}

                      {/* Draggable panel overlay - single panel mode */}
                      {selectedPanel && panelDimensions.loaded && !fillMode && (
                        <div className="absolute inset-0 pointer-events-none overflow-hidden">
                          <div
                            className={cn(
                              "absolute pointer-events-auto",
                              isDragging ? "cursor-grabbing" : "cursor-grab",
                            )}
                            style={{
                              // When we have wall corners, use perspective warp (panel conforms to wall shape)
                              // Otherwise use standard rotation transform
                              ...(targetWallCorners ? {
                                // For perspective warp: position at origin, let matrix handle placement
                                left: 0,
                                top: 0,
                                width: scaledPanelWidth,
                                height: scaledPanelHeight,
                                transformOrigin: '0 0',
                                transform: calculatePerspectiveTransformMatrix(
                                  scaledPanelWidth,
                                  scaledPanelHeight,
                                  targetWallCorners,
                                ),
                              } : {
                                // Standard rotation transform
                                left: panelTransform.x,
                                top: panelTransform.y,
                                width: scaledPanelWidth,
                                height: scaledPanelHeight,
                                transformOrigin: 'center',
                                transform: `rotateX(${panelRotation.rotateX}deg) rotateY(${panelRotation.rotateY}deg)`,
                              }),
                              transformStyle: "preserve-3d",
                              // Use faster transition with ease-out for smoother feel, no transition while dragging
                              transition: isDragging
                                ? "none"
                                : "transform 150ms ease-out",
                            }}
                            onMouseDown={handleMouseDown}
                            onTouchStart={handleTouchStart}
                          >
                            <img
                              src={selectedPanel.textureUrl}
                              alt={selectedPanel.name}
                              className="w-full h-full object-cover pointer-events-none"
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
                      {/* Note: mask-mode: luminance removed for Android browser compatibility */}
                      {selectedPanel &&
                        (enhancedForegroundMaskUrl ||
                          wallSegmentation?.foregroundMaskUrl) && (
                          <img
                            src={uploadedImage}
                            alt="Foreground"
                            className="absolute top-0 left-0 max-h-[75vh] w-auto max-w-full h-auto pointer-events-none"
                            draggable={false}
                            style={{
                              WebkitMaskImage: `url(${enhancedForegroundMaskUrl ||
                                wallSegmentation?.foregroundMaskUrl
                                })`,
                              maskImage: `url(${enhancedForegroundMaskUrl ||
                                wallSegmentation?.foregroundMaskUrl
                                })`,
                              WebkitMaskSize: "100% 100%",
                              maskSize: "100% 100%",
                              WebkitMaskRepeat: "no-repeat",
                              maskRepeat: "no-repeat",
                            }}
                          />
                        )}
                    </div>

                    {/* Compare Slider Handle */}
                    {showCompareMode && (
                      <div
                        className="absolute inset-y-0 touch-none pointer-events-auto cursor-ew-resize z-50 group"
                        style={{ left: `${comparePos}%` }}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          setIsDraggingSlider(true);
                        }}
                        onTouchStart={(e) => {
                          e.stopPropagation();
                          setIsDraggingSlider(true);
                        }}
                      >
                        {/* Line */}
                        <div className="absolute inset-y-0 -left-px w-0.5 bg-white shadow-[0_0_10px_rgba(0,0,0,0.5)] transition-colors group-hover:bg-anthracite" />

                        {/* Handle Circle */}
                        <div className="absolute top-1/2 left-0 -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white shadow-lg flex items-center justify-center transform transition-transform group-hover:scale-110">
                          <GripVertical className="w-4 h-4 text-anthracite" />
                        </div>

                        {/* Labels */}
                        <div className="absolute top-4 right-4 bg-black/50 text-white text-xs px-2 py-1 rounded backdrop-blur-sm pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">
                          Before
                        </div>
                        <div className="absolute top-4 left-4 bg-black/50 text-white text-xs px-2 py-1 rounded backdrop-blur-sm pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">
                          After
                        </div>
                      </div>
                    )}

                    {/* Depth mask canvas for composite generation */}
                    <canvas
                      ref={canvasRef}
                      className="absolute inset-0 pointer-events-none opacity-0"
                    />


                  </div>

                  {/* Transform info */}
                  {selectedPanel && !showCompareMode && (
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
    </section>
  );
}
