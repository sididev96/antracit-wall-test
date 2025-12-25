import { Layers } from "lucide-react";

export function Header() {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-lg border-b border-border">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-anthracite flex items-center justify-center shadow-soft">
            <Layers className="w-5 h-5 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-foreground">Antracit</h1>
            <p className="text-xs text-muted-foreground -mt-0.5">Wall Panel Visualizer</p>
          </div>
        </div>
        
        <nav className="hidden md:flex items-center gap-8">
          <a href="#visualizer" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
            Visualizer
          </a>
          <a href="#catalog" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
            Catalog
          </a>
          <a href="#how-it-works" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
            How It Works
          </a>
        </nav>
      </div>
    </header>
  );
}
