import { useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "./ui/button";
import { PanelCard } from "./PanelCard";
import { WallPanel } from "@/types/panel";
import { samplePanels } from "@/data/samplePanels";
import { cn } from "@/lib/utils";

interface PanelSelectorProps {
  selectedPanel: WallPanel | null;
  onSelect: (panel: WallPanel) => void;
  compact?: boolean;
}

export function PanelSelector({
  selectedPanel,
  onSelect,
  compact = false,
}: PanelSelectorProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const scrollPanels = (direction: "left" | "right") => {
    if (!scrollRef.current) return;
    const scrollAmount = 300;
    scrollRef.current.scrollBy({
      left: direction === "left" ? -scrollAmount : scrollAmount,
      behavior: "smooth",
    });
  };

  // Compact vertical layout for sidebar
  if (compact) {
    return (
      <div className="flex flex-col gap-3">
        {samplePanels.map((panel) => (
          <div
            key={panel.id}
            className={cn(
              "relative rounded-xl overflow-hidden cursor-pointer transition-all duration-200 border-2",
              selectedPanel?.id === panel.id
                ? "border-anthracite shadow-medium ring-2 ring-anthracite/20"
                : "border-transparent hover:border-muted-foreground/30"
            )}
            onClick={() => onSelect(panel)}
          >
            <img
              src={panel.imageUrl}
              alt={panel.name}
              className="w-full h-24 object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
            <div className="absolute bottom-0 left-0 right-0 p-2">
              <p className="text-white text-sm font-medium truncate">
                {panel.name}
              </p>
            </div>
            {selectedPanel?.id === panel.id && (
              <div className="absolute top-2 right-2 w-5 h-5 bg-anthracite rounded-full flex items-center justify-center">
                <svg
                  className="w-3 h-3 text-white"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={3}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }

  // Default horizontal scrolling layout
  return (
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
          <div key={panel.id} className="w-36 sm:w-64 shrink-0 snap-start">
            <PanelCard
              panel={panel}
              isSelected={selectedPanel?.id === panel.id}
              onSelect={onSelect}
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
  );
}
