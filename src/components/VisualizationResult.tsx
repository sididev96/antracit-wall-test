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
  const handleDownload = () => {
    const link = document.createElement("a");
    link.download = `antracit-${selectedPanel.id}-visualization.png`;
    link.href = visualizedImage;
    link.click();
    toast.success("Image downloaded!");
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
        <div 
          className="w-16 h-16 rounded-lg shrink-0"
          style={{
            background: `linear-gradient(135deg, ${selectedPanel.colors[0]} 0%, ${selectedPanel.colors[1]} 100%)`,
          }}
        />
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
