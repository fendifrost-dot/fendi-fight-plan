import HeroSection from "@/components/HeroSection";
import SystemGuide from "@/components/SystemGuide";
import AIAnalyzer from "@/components/AIAnalyzer";
import TemplateSection from "@/components/TemplateSection";
import Footer from "@/components/Footer";

const Index = () => {
  return (
    <main className="min-h-screen bg-background">
      <HeroSection />
      <SystemGuide />
      <AIAnalyzer />
      <TemplateSection />
      <Footer />
    </main>
  );
};

export default Index;
