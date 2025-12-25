import { Upload, MousePointer, Palette, Download } from "lucide-react";

const steps = [
  {
    icon: Upload,
    title: "Upload Your Photo",
    description: "Take a photo of your room or wall and upload it to our visualizer",
  },
  {
    icon: MousePointer,
    title: "Select the Wall",
    description: "Draw over the wall area where you want to apply the panel",
  },
  {
    icon: Palette,
    title: "Choose Your Panel",
    description: "Browse our collection and select the panel that matches your vision",
  },
  {
    icon: Download,
    title: "Save & Share",
    description: "Download your visualization or share it with friends and family",
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="py-20 bg-surface-subtle">
      <div className="container mx-auto px-4">
        <div className="text-center mb-16 animate-slide-up">
          <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
            How It Works
          </h2>
          <p className="text-muted-foreground max-w-xl mx-auto">
            Transform your space in four simple steps
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 stagger-children">
          {steps.map((step, index) => (
            <div
              key={index}
              className="relative text-center group"
            >
              {/* Connector line (hidden on mobile and last item) */}
              {index < steps.length - 1 && (
                <div className="hidden lg:block absolute top-10 left-[60%] right-0 h-px bg-border" />
              )}

              <div className="relative z-10 mb-6 mx-auto w-20 h-20 rounded-2xl bg-card shadow-soft flex items-center justify-center group-hover:shadow-medium transition-all duration-300 group-hover:scale-105">
                <step.icon className="w-8 h-8 text-anthracite" />
                <span className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-anthracite text-primary-foreground text-xs font-bold flex items-center justify-center">
                  {index + 1}
                </span>
              </div>

              <h3 className="text-lg font-semibold text-foreground mb-2">
                {step.title}
              </h3>
              <p className="text-sm text-muted-foreground max-w-xs mx-auto">
                {step.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
