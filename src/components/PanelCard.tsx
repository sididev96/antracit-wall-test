import { Check } from "lucide-react";
import { WallPanel } from "@/types/panel";
import { cn } from "@/lib/utils";

interface PanelCardProps {
  panel: WallPanel;
  isSelected: boolean;
  onSelect: (panel: WallPanel) => void;
}

export function PanelCard({ panel, isSelected, onSelect }: PanelCardProps) {
  return (
    <button
      onClick={() => onSelect(panel)}
      className={cn(
        "group relative w-full text-left rounded-2xl overflow-hidden transition-all duration-300",
        "bg-card border-2 shadow-soft hover:shadow-medium",
        isSelected
          ? "border-anthracite ring-2 ring-anthracite/20"
          : "border-transparent hover:border-border"
      )}
    >
      {/* Panel texture preview */}
      <div className="aspect-[4/3] relative overflow-hidden bg-muted">
        <img
          src={panel.imageUrl}
          alt={panel.name}
          className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
        />

        {/* Selection indicator */}
        {isSelected && (
          <div className="absolute top-3 right-3 w-8 h-8 rounded-full bg-anthracite flex items-center justify-center animate-scale-in">
            <Check className="w-4 h-4 text-primary-foreground" />
          </div>
        )}
      </div>

      {/* Panel info */}
      <div className="p-2 sm:p-4">
        <div className="flex items-start justify-between gap-1 sm:gap-2 mb-1 sm:mb-2">
          <h3 className="font-semibold text-foreground group-hover:text-anthracite transition-colors text-xs sm:text-base line-clamp-1">
            {panel.name}
          </h3>
          {panel.price && (
            <span className="text-[9px] sm:text-sm font-medium text-muted-foreground shrink-0">
              {panel.price}
            </span>
          )}
        </div>

        <p className="text-sm text-muted-foreground line-clamp-2 mb-3 hidden sm:block">
          {panel.description}
        </p>

        <div className="flex items-center justify-between">
          <span className="text-[9px] sm:text-xs font-medium text-muted-foreground px-1 sm:px-2 sm:py-1 rounded-md bg-muted">
            {panel.category}
          </span>

          <div className="flex items-center gap-0.5 sm:gap-1">
            {panel.colors.map((color, i) => (
              <div
                key={i}
                className="w-2.5 h-2.5 sm:w-4 sm:h-4 rounded-full border border-border shadow-sm"
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
        </div>
      </div>
    </button>
  );
}
