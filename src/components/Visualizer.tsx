import { useState, useCallback, useEffect } from "react";
import { ImageUploader } from "./ImageUploader";
import { WallSelector } from "./WallSelector";
import { VisualizationResult } from "./VisualizationResult";
import { PanelSelector } from "./PanelSelector";
import { WallPanel } from "@/types/panel";
import { ArrowRight, Loader2, ChevronRight } from "lucide-react";
import { Button } from "./ui/button";
import { cn } from "@/lib/utils";
import { applyTextureWithMask } from "@/lib/textureUtils";
import { toast } from "sonner";

type Step = "upload" | "select-wall" | "select-panel" | "result";

export function Visualizer() {
  const [step, setStep] = useState<Step>("upload");
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [wallMask, setWallMask] = useState<string | null>(null);
  const [selectedPanel, setSelectedPanel] = useState<WallPanel | null>(null);
  const [visualizedImage, setVisualizedImage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const handleImageUpload = useCallback((imageUrl: string) => {
    setUploadedImage(imageUrl);
    setStep("select-wall");
  }, []);

  const handleClearImage = useCallback(() => {
    setUploadedImage(null);
    setWallMask(null);
    setSelectedPanel(null);
    setVisualizedImage(null);
    setStep("upload");
  }, []);

  const handleMaskComplete = useCallback((maskDataUrl: string) => {
    setWallMask(maskDataUrl);
    setStep("select-panel");
  }, []);

  const applyVisualization = useCallback(async (panel: WallPanel) => {
    if (!uploadedImage || !wallMask) return;

    setIsProcessing(true);
    try {
      const result = await applyTextureWithMask(
        uploadedImage,
        wallMask,
        panel.textureUrl,
        panel.colors
      );
      setVisualizedImage(result);
      setStep("result");
      if (step !== "result") {
        toast.success("Visualization complete!");
      }
    } catch (error) {
      console.error("Failed to apply visualization:", error);
      toast.error("Failed to apply visualization. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  }, [uploadedImage, wallMask, step]);

  const handleSelectPanel = useCallback((panel: WallPanel) => {
    setSelectedPanel(panel);

    // If we are already in the result view, apply immediately
    if (step === "result") {
      applyVisualization(panel);
    }
  }, [step, applyVisualization]);

  const handleApplyClick = useCallback(() => {
    if (selectedPanel) {
      applyVisualization(selectedPanel);
    }
  }, [selectedPanel, applyVisualization]);

  const handleReset = useCallback(() => {
    handleClearImage();
  }, [handleClearImage]);

  const steps = [
    { key: "upload", label: "Upload Photo" },
    { key: "select-wall", label: "Select Wall" },
    { key: "select-panel", label: "Choose Panel" },
    { key: "result", label: "View Result" },
  ];

  const currentStepIndex = steps.findIndex((s) => s.key === step);

  return (
    <section id="visualizer" className="py-20 bg-background">
      <div className="container mx-auto px-4">
        <div className="text-center mb-12 animate-slide-up">
          <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
            Visualize Your Space
          </h2>
          <p className="text-muted-foreground max-w-xl mx-auto">
            Follow the steps below to see how our panels will transform your room
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
                <ChevronRight className={cn(
                  "w-4 h-4 mx-1",
                  i < currentStepIndex ? "text-anthracite" : "text-muted-foreground"
                )} />
              )}
            </div>
          ))}
        </div>

        {/* Step content */}
        <div className="max-w-4xl mx-auto">
          {step === "upload" && (
            <ImageUploader
              uploadedImage={uploadedImage}
              onImageUpload={handleImageUpload}
              onClear={handleClearImage}
            />
          )}

          {step === "select-wall" && uploadedImage && (
            <WallSelector
              imageUrl={uploadedImage}
              onMaskComplete={handleMaskComplete}
            />
          )}

          {step === "select-panel" && (
            <div className="space-y-6">
              <div className="text-center">
                <h3 className="text-xl font-semibold text-foreground mb-2">
                  Select a Panel
                </h3>
                <p className="text-muted-foreground text-sm">
                  Choose the panel you want to visualize on your wall
                </p>
              </div>

              <PanelSelector
                selectedPanel={selectedPanel}
                onSelect={handleSelectPanel}
              />

              {selectedPanel && (
                <div className="flex justify-center animate-slide-up">
                  <Button
                    variant="hero"
                    size="lg"
                    onClick={handleApplyClick}
                    disabled={isProcessing}
                  >
                    {isProcessing ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Processing...
                      </>
                    ) : (
                      <>
                        Apply {selectedPanel.name}
                        <ArrowRight className="w-4 h-4 ml-2" />
                      </>
                    )}
                  </Button>
                </div>
              )}
            </div>
          )}

          {step === "result" && uploadedImage && visualizedImage && selectedPanel && (
            <div className="space-y-8">
              <div className={cn("transition-opacity duration-300", isProcessing ? "opacity-50 pointer-events-none" : "opacity-100")}>
                <VisualizationResult
                  originalImage={uploadedImage}
                  visualizedImage={visualizedImage}
                  selectedPanel={selectedPanel}
                  onReset={handleReset}
                />
              </div>

              <div className="space-y-6 pt-8 border-t border-border/50">
                <div className="text-center">
                  <p className="text-sm font-semibold text-foreground tracking-wider uppercase">
                    Switch Panel Style
                  </p>
                </div>
                <PanelSelector
                  selectedPanel={selectedPanel}
                  onSelect={handleSelectPanel}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
