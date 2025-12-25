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
      <div className="aspect-[4/3] relative overflow-hidden">
        <div 
          className="absolute inset-0 transition-transform duration-500 group-hover:scale-105"
          style={{
            background: `linear-gradient(135deg, ${panel.colors[0]} 0%, ${panel.colors[1]} 50%, ${panel.colors[2]} 100%)`,
          }}
        />
        
        {/* Texture overlay simulation */}
        <div className="absolute inset-0 opacity-30" style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 400 400' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`,
        }} />
        
        {/* Selection indicator */}
        {isSelected && (
          <div className="absolute top-3 right-3 w-8 h-8 rounded-full bg-anthracite flex items-center justify-center animate-scale-in">
            <Check className="w-4 h-4 text-primary-foreground" />
          </div>
        )}
      </div>
      
      {/* Panel info */}
      <div className="p-4">
        <div className="flex items-start justify-between gap-2 mb-2">
          <h3 className="font-semibold text-foreground group-hover:text-anthracite transition-colors">
            {panel.name}
          </h3>
          {panel.price && (
            <span className="text-sm font-medium text-muted-foreground shrink-0">
              {panel.price}
            </span>
          )}
        </div>
        
        <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
          {panel.description}
        </p>
        
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground px-2 py-1 rounded-md bg-muted">
            {panel.category}
          </span>
          
          <div className="flex items-center gap-1">
            {panel.colors.map((color, i) => (
              <div
                key={i}
                className="w-4 h-4 rounded-full border border-border shadow-sm"
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
        </div>
      </div>
    </button>
  );
}
