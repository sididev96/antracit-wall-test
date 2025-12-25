import { useState, useRef, useCallback, useEffect } from "react";
import { Undo2, RotateCcw, Check, MousePointer, Trash2 } from "lucide-react";
import { Button } from "./ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface Point {
  x: number;
  y: number;
}

interface WallSelectorProps {
  imageUrl: string;
  onMaskComplete: (maskDataUrl: string) => void;
}

export function WallSelector({ imageUrl, onMaskComplete }: WallSelectorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [points, setPoints] = useState<Point[]>([]);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [isPolygonClosed, setIsPolygonClosed] = useState(false);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const canvasDimensions = useRef<{ width: number; height: number }>({ width: 800, height: 600 });

  // Initialize canvas with the image
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      // Set canvas size to match image aspect ratio
      const maxWidth = 800;
      const scale = Math.min(1, maxWidth / img.width);
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      canvasDimensions.current = { width: canvas.width, height: canvas.height };

      // Draw the image
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      imageRef.current = img;
      setImageLoaded(true);
    };
    img.src = imageUrl;
  }, [imageUrl]);

  // Redraw canvas whenever points change
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx || !imageRef.current || !imageLoaded) return;

    // Clear and redraw the image
    ctx.drawImage(imageRef.current, 0, 0, canvas!.width, canvas!.height);

    if (points.length === 0) return;

    // Draw the polygon
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);

    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }

    if (isPolygonClosed && points.length > 2) {
      ctx.closePath();
      // Fill with semi-transparent overlay
      ctx.fillStyle = "rgba(50, 50, 50, 0.4)";
      ctx.fill();
    }

    // Draw the stroke
    ctx.strokeStyle = "#333";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Draw points
    points.forEach((point, index) => {
      ctx.beginPath();
      ctx.arc(point.x, point.y, 6, 0, Math.PI * 2);

      // First point is special (closing point)
      if (index === 0 && points.length > 2 && !isPolygonClosed) {
        ctx.fillStyle = "#22c55e"; // Green for the closing point
      } else {
        ctx.fillStyle = "#333";
      }
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.stroke();
    });

    // Draw connection line to first point if we have enough points
    if (points.length > 2 && !isPolygonClosed) {
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(points[points.length - 1].x, points[points.length - 1].y);
      ctx.lineTo(points[0].x, points[0].y);
      ctx.strokeStyle = "rgba(50, 50, 50, 0.5)";
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }, [points, isPolygonClosed, imageLoaded]);

  const getCoordinates = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    if ("touches" in e) {
      return {
        x: (e.touches[0].clientX - rect.left) * scaleX,
        y: (e.touches[0].clientY - rect.top) * scaleY,
      };
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }, []);

  const isNearFirstPoint = useCallback((point: Point) => {
    if (points.length < 3) return false;
    const firstPoint = points[0];
    const distance = Math.sqrt(
      Math.pow(point.x - firstPoint.x, 2) + Math.pow(point.y - firstPoint.y, 2)
    );
    return distance < 15; // 15px threshold
  }, [points]);

  const handleCanvasClick = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (isPolygonClosed) return; // Don't add more points if polygon is closed

    const coords = getCoordinates(e);

    // Check if clicking near the first point to close the polygon
    if (isNearFirstPoint(coords)) {
      setIsPolygonClosed(true);
      toast.success("Wall area selected! Click confirm to continue.");
      return;
    }

    setPoints(prev => [...prev, coords]);
  }, [getCoordinates, isNearFirstPoint, isPolygonClosed]);

  const undoLastPoint = useCallback(() => {
    if (isPolygonClosed) {
      setIsPolygonClosed(false);
    } else {
      setPoints(prev => prev.slice(0, -1));
    }
  }, [isPolygonClosed]);

  const resetCanvas = useCallback(() => {
    setPoints([]);
    setIsPolygonClosed(false);
    toast.info("Selection cleared");
  }, []);

  const confirmSelection = useCallback(() => {
    if (points.length < 3) {
      toast.error("Please select at least 3 points to form a wall area");
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;

    // Pass polygon data as JSON (points + canvas dimensions)
    // This allows the texture utility to use canvas clipping for precise filling
    const polygonData = {
      points: points,
      canvasWidth: canvas.width,
      canvasHeight: canvas.height
    };

    onMaskComplete(JSON.stringify(polygonData));
    toast.success("Wall area confirmed!");
  }, [points, onMaskComplete]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface-elevated shadow-soft text-sm text-muted-foreground">
            <MousePointer className="w-4 h-4" />
            <span>{points.length} points</span>
          </div>
          <Button
            variant="minimal"
            size="sm"
            onClick={undoLastPoint}
            disabled={points.length === 0}
          >
            <Undo2 className="w-4 h-4 mr-1" />
            Undo
          </Button>
          <Button variant="minimal" size="sm" onClick={resetCanvas}>
            <RotateCcw className="w-4 h-4 mr-1" />
            Reset
          </Button>
        </div>

        <Button
          variant="hero"
          size="sm"
          onClick={confirmSelection}
          disabled={points.length < 3}
        >
          <Check className="w-4 h-4 mr-1" />
          Confirm
        </Button>
      </div>

      {/* Instructions */}
      <div className="text-center py-2 px-4 rounded-lg bg-muted/50">
        {!isPolygonClosed ? (
          <p className="text-sm text-muted-foreground">
            {points.length === 0 && "Click on the image to place points around the wall area"}
            {points.length > 0 && points.length < 3 && `Place ${3 - points.length} more point${3 - points.length > 1 ? 's' : ''} to form a shape`}
            {points.length >= 3 && "Click near the first point (green) to close the shape, or continue adding points"}
          </p>
        ) : (
          <p className="text-sm text-green-600 font-medium">
            ✓ Shape complete! Click "Confirm" to proceed or "Reset" to start over
          </p>
        )}
      </div>

      {/* Canvas */}
      <div className="relative rounded-2xl overflow-hidden bg-muted shadow-medium">
        <canvas
          ref={canvasRef}
          onClick={handleCanvasClick}
          onTouchEnd={handleCanvasClick}
          className={cn(
            "w-full h-auto cursor-crosshair touch-none",
            !imageLoaded && "opacity-0",
            isPolygonClosed && "cursor-default"
          )}
        />
        {!imageLoaded && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-8 h-8 border-2 border-anthracite border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>
    </div>
  );
}
