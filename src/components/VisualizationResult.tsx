import { Download, Share2, RefreshCw } from "lucide-react";
import { Button } from "./ui/button";
import { BeforeAfterSlider } from "./BeforeAfterSlider";
import { WallPanel } from "@/types/panel";
import { toast } from "sonner";

interface VisualizationResultProps {
  originalImage: string;
  visualizedImage: string;
  selectedPanel: WallPanel;
  onReset: () => void;
}

export function VisualizationResult({
  originalImage,
  visualizedImage,
  selectedPanel,
  onReset,
}: VisualizationResultProps) {
  const handleDownload = async () => {
    try {
      // Convert the PNG data URL to JPG
      const img = new Image();
      img.crossOrigin = "anonymous";

      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = reject;
        img.src = visualizedImage;
      });

      // Create a canvas and draw the image
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d")!;

      // Fill with white background (JPG doesn't support transparency)
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);

      // Convert canvas to blob directly
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => {
            if (b) resolve(b);
            else reject(new Error("Failed to create blob"));
          },
          "image/jpeg",
          0.92
        );
      });

      // Create object URL from blob
      const blobUrl = URL.createObjectURL(blob);
      const filename = `antracit-${selectedPanel.id}-visualization.jpg`;

      // Create and trigger download
      const link = document.createElement("a");
      link.style.display = "none";
      link.href = blobUrl;
      link.download = filename;
      link.setAttribute("download", filename);

      document.body.appendChild(link);
      link.click();

      // Cleanup after a delay
      setTimeout(() => {
        document.body.removeChild(link);
        URL.revokeObjectURL(blobUrl);
      }, 100);

      toast.success("Image downloaded!");
    } catch (error) {
      console.error("Download failed:", error);
      toast.error("Failed to download image");
    }
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Antracit - ${selectedPanel.name} Visualization`,
          text: `Check out how ${selectedPanel.name} looks on my wall!`,
          url: window.location.href,
        });
      } catch (err) {
        // User cancelled sharing
      }
    } else {
      await navigator.clipboard.writeText(window.location.href);
      toast.success("Link copied to clipboard!");
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h3 className="text-xl font-semibold text-foreground mb-1">
            Your Room with {selectedPanel.name}
          </h3>
          <p className="text-muted-foreground text-sm">
            Drag the slider to compare before and after
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="minimal" size="sm" onClick={onReset}>
            <RefreshCw className="w-4 h-4 mr-1" />
            Try Another
          </Button>
          <Button variant="secondary" size="sm" onClick={handleShare}>
            <Share2 className="w-4 h-4 mr-1" />
            Share
          </Button>
          <Button variant="hero" size="sm" onClick={handleDownload}>
            <Download className="w-4 h-4 mr-1" />
            Download
          </Button>
        </div>
      </div>

      <BeforeAfterSlider
        beforeImage={originalImage}
        afterImage={visualizedImage}
      />

      {/* Panel details card */}
      <div className="flex items-center gap-4 p-4 rounded-xl bg-card border border-border shadow-soft">
        <div className="w-16 h-16 rounded-lg shrink-0 overflow-hidden bg-muted">
          <img
            src={selectedPanel.imageUrl}
            alt={selectedPanel.name}
            className="w-full h-full object-cover"
          />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="font-semibold text-foreground">{selectedPanel.name}</h4>
          <p className="text-sm text-muted-foreground">{selectedPanel.material} • {selectedPanel.category}</p>
        </div>
        {selectedPanel.price && (
          <div className="text-right shrink-0">
            <p className="font-semibold text-foreground">{selectedPanel.price}</p>
            <p className="text-xs text-muted-foreground">per square meter</p>
          </div>
        )}
      </div>
    </div>
  );
}
