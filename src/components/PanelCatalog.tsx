import { useState } from "react";
import { samplePanels, categories } from "@/data/samplePanels";
import { WallPanel } from "@/types/panel";
import { PanelCard } from "./PanelCard";
import { cn } from "@/lib/utils";

interface PanelCatalogProps {
  selectedPanel: WallPanel | null;
  onSelectPanel: (panel: WallPanel) => void;
}

export function PanelCatalog({ selectedPanel, onSelectPanel }: PanelCatalogProps) {
  const [activeCategory, setActiveCategory] = useState("All");
  
  const filteredPanels = activeCategory === "All" 
    ? samplePanels 
    : samplePanels.filter(p => p.category === activeCategory);

  return (
    <section id="catalog" className="py-20 bg-surface-subtle">
      <div className="container mx-auto px-4">
        <div className="text-center mb-12 animate-slide-up">
          <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
            Panel Collection
          </h2>
          <p className="text-muted-foreground max-w-xl mx-auto">
            Browse our curated selection of premium wall panels. Click to select and visualize on your wall.
          </p>
        </div>
        
        {/* Category filters */}
        <div className="flex items-center justify-center gap-2 mb-10">
          {categories.map((category) => (
            <button
              key={category}
              onClick={() => setActiveCategory(category)}
              className={cn(
                "px-5 py-2 rounded-full text-sm font-medium transition-all duration-300",
                activeCategory === category
                  ? "bg-anthracite text-primary-foreground shadow-soft"
                  : "bg-card text-muted-foreground hover:bg-secondary hover:text-foreground border border-border"
              )}
            >
              {category}
            </button>
          ))}
        </div>
        
        {/* Panel grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 stagger-children">
          {filteredPanels.map((panel) => (
            <PanelCard
              key={panel.id}
              panel={panel}
              isSelected={selectedPanel?.id === panel.id}
              onSelect={onSelectPanel}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
