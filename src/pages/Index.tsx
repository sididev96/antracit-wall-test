import { Header } from "@/components/Header";
import { Hero } from "@/components/Hero";
import { Visualizer } from "@/components/Visualizer";
import { PanelCatalog } from "@/components/PanelCatalog";
import { HowItWorks } from "@/components/HowItWorks";
import { Footer } from "@/components/Footer";
import { useState } from "react";
import { WallPanel } from "@/types/panel";
import { Helmet } from "react-helmet-async";

const Index = () => {
  const [selectedPanel, setSelectedPanel] = useState<WallPanel | null>(null);

  return (
    <>
      <Helmet>
        <title>Antracit Wall Panel Visualizer | See Panels on Your Walls</title>
        <meta name="description" content="Visualize premium wall panels in your space. Upload a photo of your room and see how Antracit panels transform your walls before you buy." />
        <meta name="keywords" content="wall panels, wall visualizer, interior design, room visualization, Antracit panels" />
      </Helmet>
      
      <div className="min-h-screen bg-background">
        <Header />
        
        <main>
          <Hero />
          <Visualizer />
          <PanelCatalog 
            selectedPanel={selectedPanel} 
            onSelectPanel={setSelectedPanel} 
          />
          <HowItWorks />
        </main>
        
        <Footer />
      </div>
    </>
  );
};

export default Index;
