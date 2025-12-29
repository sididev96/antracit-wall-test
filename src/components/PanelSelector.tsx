import { useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "./ui/button";
import { PanelCard } from "./PanelCard";
import { WallPanel } from "@/types/panel";
import { samplePanels } from "@/data/samplePanels";

interface PanelSelectorProps {
    selectedPanel: WallPanel | null;
    onSelect: (panel: WallPanel) => void;
}

export function PanelSelector({ selectedPanel, onSelect }: PanelSelectorProps) {
    const scrollRef = useRef<HTMLDivElement>(null);

    const scrollPanels = (direction: "left" | "right") => {
        if (!scrollRef.current) return;
        const scrollAmount = 300;
        scrollRef.current.scrollBy({
            left: direction === "left" ? -scrollAmount : scrollAmount,
            behavior: "smooth",
        });
    };

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
