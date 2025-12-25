import { Layers } from "lucide-react";

export function Footer() {
  return (
    <footer className="py-12 bg-anthracite text-primary-foreground">
      <div className="container mx-auto px-4">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary-foreground/10 flex items-center justify-center">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-semibold">Antracit</h3>
              <p className="text-sm text-primary-foreground/60">Premium Wall Panels</p>
            </div>
          </div>

          <div className="flex items-center gap-8 text-sm text-primary-foreground/60">
            <a href="#" className="hover:text-primary-foreground transition-colors">
              About
            </a>
            <a href="#" className="hover:text-primary-foreground transition-colors">
              Contact
            </a>
            <a href="#" className="hover:text-primary-foreground transition-colors">
              Privacy
            </a>
            <a href="#" className="hover:text-primary-foreground transition-colors">
              Terms
            </a>
          </div>

          <p className="text-sm text-primary-foreground/60">
            © {new Date().getFullYear()} Antracit. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
