import { useState, useCallback, useEffect, useRef } from "react";
import { ImageUploader } from "./ImageUploader";
import { WallSelector } from "./WallSelector";
import { VisualizationResult } from "./VisualizationResult";
import { WallPanel } from "@/types/panel";
import { samplePanels } from "@/data/samplePanels";
import { PanelCard } from "./PanelCard";
import { ChevronLeft, ChevronRight, ArrowRight } from "lucide-react";
import { Button } from "./ui/button";
import { cn } from "@/lib/utils";

type Step = "upload" | "select-wall" | "select-panel" | "result";

export function Visualizer() {
  const [step, setStep] = useState<Step>("upload");
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [wallMask, setWallMask] = useState<string | null>(null);
  const [selectedPanel, setSelectedPanel] = useState<WallPanel | null>(null);
  const [visualizedImage, setVisualizedImage] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

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

  const handleSelectPanel = useCallback((panel: WallPanel) => {
    setSelectedPanel(panel);
  }, []);

  const applyVisualization = useCallback(() => {
    if (!wallMask || !selectedPanel) return;

    // For now, we'll use the mask as the result (actual blending would require AI/backend)
    // In production, this would send to an AI service for proper texture blending
    setVisualizedImage(wallMask);
    setStep("result");
  }, [wallMask, selectedPanel]);

  const handleReset = useCallback(() => {
    handleClearImage();
  }, [handleClearImage]);

  const scrollPanels = (direction: "left" | "right") => {
    if (!scrollRef.current) return;
    const scrollAmount = 300;
    scrollRef.current.scrollBy({
      left: direction === "left" ? -scrollAmount : scrollAmount,
      behavior: "smooth",
    });
  };

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

              {/* Horizontal scrollable panel selector */}
              <div className="relative">
                <Button
                  variant="minimal"
                  size="icon"
                  className="absolute left-0 top-1/2 -translate-y-1/2 z-10 bg-card/90 backdrop-blur-sm shadow-soft hidden sm:flex"
                  onClick={() => scrollPanels("left")}
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                
                <div
                  ref={scrollRef}
                  className="flex gap-4 overflow-x-auto pb-4 px-8 scrollbar-hide snap-x snap-mandatory"
                  style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
                >
                  {samplePanels.map((panel) => (
                    <div key={panel.id} className="w-64 shrink-0 snap-start">
                      <PanelCard
                        panel={panel}
                        isSelected={selectedPanel?.id === panel.id}
                        onSelect={handleSelectPanel}
                      />
                    </div>
                  ))}
                </div>

                <Button
                  variant="minimal"
                  size="icon"
                  className="absolute right-0 top-1/2 -translate-y-1/2 z-10 bg-card/90 backdrop-blur-sm shadow-soft hidden sm:flex"
                  onClick={() => scrollPanels("right")}
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>

              {selectedPanel && (
                <div className="flex justify-center animate-slide-up">
                  <Button variant="hero" size="lg" onClick={applyVisualization}>
                    Apply {selectedPanel.name}
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </div>
              )}
            </div>
          )}

          {step === "result" && uploadedImage && visualizedImage && selectedPanel && (
            <VisualizationResult
              originalImage={uploadedImage}
              visualizedImage={visualizedImage}
              selectedPanel={selectedPanel}
              onReset={handleReset}
            />
          )}
        </div>
      </div>
    </section>
  );
}
