import { useState, useRef, useCallback, useEffect } from "react";
import { Pencil, Eraser, RotateCcw, Wand2, Check } from "lucide-react";
import { Button } from "./ui/button";
import { Slider } from "./ui/slider";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface WallSelectorProps {
  imageUrl: string;
  onMaskComplete: (maskDataUrl: string) => void;
}

export function WallSelector({ imageUrl, onMaskComplete }: WallSelectorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [tool, setTool] = useState<"draw" | "erase">("draw");
  const [brushSize, setBrushSize] = useState(30);
  const [imageLoaded, setImageLoaded] = useState(false);
  const imageRef = useRef<HTMLImageElement | null>(null);

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
      
      // Draw the image
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      imageRef.current = img;
      setImageLoaded(true);
    };
    img.src = imageUrl;
  }, [imageUrl]);

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

  const draw = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx) return;

    const { x, y } = getCoordinates(e);

    ctx.beginPath();
    ctx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
    
    if (tool === "draw") {
      ctx.fillStyle = "rgba(50, 50, 50, 0.5)";
      ctx.fill();
    } else {
      // Restore original image in erased area
      if (imageRef.current) {
        ctx.save();
        ctx.clip();
        ctx.drawImage(imageRef.current, 0, 0, canvas!.width, canvas!.height);
        ctx.restore();
      }
    }
  }, [isDrawing, brushSize, tool, getCoordinates]);

  const startDrawing = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    setIsDrawing(true);
    draw(e);
  }, [draw]);

  const stopDrawing = useCallback(() => {
    setIsDrawing(false);
  }, []);

  const resetCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx || !imageRef.current) return;

    ctx.drawImage(imageRef.current, 0, 0, canvas!.width, canvas!.height);
    toast.info("Canvas reset");
  }, []);

  const autoDetect = useCallback(() => {
    toast.info("AI wall detection coming soon! For now, draw on the wall area manually.");
  }, []);

  const confirmSelection = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    onMaskComplete(canvas.toDataURL("image/png"));
    toast.success("Wall area selected!");
  }, [onMaskComplete]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Button
            variant={tool === "draw" ? "hero" : "minimal"}
            size="sm"
            onClick={() => setTool("draw")}
          >
            <Pencil className="w-4 h-4 mr-1" />
            Draw
          </Button>
          <Button
            variant={tool === "erase" ? "hero" : "minimal"}
            size="sm"
            onClick={() => setTool("erase")}
          >
            <Eraser className="w-4 h-4 mr-1" />
            Erase
          </Button>
          <Button variant="minimal" size="sm" onClick={resetCanvas}>
            <RotateCcw className="w-4 h-4 mr-1" />
            Reset
          </Button>
        </div>
        
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={autoDetect}>
            <Wand2 className="w-4 h-4 mr-1" />
            Auto-Detect
          </Button>
          <Button variant="hero" size="sm" onClick={confirmSelection}>
            <Check className="w-4 h-4 mr-1" />
            Confirm
          </Button>
        </div>
      </div>

      {/* Brush size slider */}
      <div className="flex items-center gap-4 px-2">
        <span className="text-sm text-muted-foreground min-w-fit">Brush: {brushSize}px</span>
        <Slider
          value={[brushSize]}
          onValueChange={([value]) => setBrushSize(value)}
          min={10}
          max={100}
          step={5}
          className="flex-1 max-w-48"
        />
      </div>

      {/* Canvas */}
      <div className="relative rounded-2xl overflow-hidden bg-muted shadow-medium">
        <canvas
          ref={canvasRef}
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
          className={cn(
            "w-full h-auto cursor-crosshair touch-none",
            !imageLoaded && "opacity-0"
          )}
        />
        {!imageLoaded && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-8 h-8 border-2 border-anthracite border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>

      <p className="text-sm text-muted-foreground text-center">
        Draw over the wall area you want to apply the panel to. Use erase to correct mistakes.
      </p>
    </div>
  );
}
