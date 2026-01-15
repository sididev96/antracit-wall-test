import { useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "./ui/button";
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
      <div className="flex flex-col gap-2">
        {samplePanels.map((panel) => (
          <div
            key={panel.id}
            className={cn(
              "group relative aspect-square rounded-lg overflow-hidden cursor-pointer transition-all duration-200 border-2",
              selectedPanel?.id === panel.id
                ? "border-anthracite shadow-medium ring-2 ring-anthracite/20"
                : "border-transparent hover:border-muted-foreground/30"
            )}
            onClick={() => onSelect(panel)}
          >
            <img
              src={panel.imageUrl}
              alt={panel.name}
              className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-110"
            />
            {/* Hover overlay with text */}
            <div className="absolute inset-0 bg-black/70 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex flex-col items-center justify-center p-2 text-center">
              <p className="text-white text-xs font-semibold mb-0.5">
                {panel.name}
              </p>
              {panel.price && (
                <p className="text-white/80 text-[10px]">{panel.price}</p>
              )}
            </div>
            {selectedPanel?.id === panel.id && (
              <div className="absolute top-1 right-1 w-5 h-5 bg-anthracite rounded-full flex items-center justify-center">
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

  // Horizontal scrolling layout - square texture-only buttons
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
        className="flex gap-3 overflow-x-auto pb-4 px-8 scrollbar-hide"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        {samplePanels.map((panel) => (
          <div
            key={panel.id}
            className={cn(
              "group relative w-20 h-20 sm:w-28 sm:h-28 shrink-0 rounded-lg overflow-hidden cursor-pointer transition-all duration-200 border-2",
              selectedPanel?.id === panel.id
                ? "border-anthracite shadow-medium ring-2 ring-anthracite/20"
                : "border-transparent hover:border-muted-foreground/30"
            )}
            onClick={() => onSelect(panel)}
          >
            <img
              src={panel.imageUrl}
              alt={panel.name}
              className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-110"
            />
            {/* Hover overlay with text */}
            <div className="absolute inset-0 bg-black/75 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex flex-col items-center justify-center p-1 text-center">
              <p className="text-white text-[10px] sm:text-xs font-semibold mb-0 sm:mb-0.5">
                {panel.name}
              </p>
              {panel.price && (
                <p className="text-white/80 text-[8px] sm:text-[10px]">
                  {panel.price}
                </p>
              )}
            </div>
            {selectedPanel?.id === panel.id && (
              <div className="absolute top-1 right-1 w-4 h-4 sm:w-5 sm:h-5 bg-anthracite rounded-full flex items-center justify-center">
                <svg
                  className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-white"
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
