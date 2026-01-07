import { Suspense, lazy } from "react";
import HeroSection from "@/components/HeroSection";
import SystemGuide from "@/components/SystemGuide";
import TemplateSection from "@/components/TemplateSection";
import Footer from "@/components/Footer";
import { Loader2 } from "lucide-react";

// Lazy load AIAnalyzer to prevent PDF.js from blocking initial render
const AIAnalyzer = lazy(() => import("@/components/AIAnalyzer"));

const AnalyzerFallback = () => (
  <section className="py-16 px-4 flex justify-center items-center min-h-[300px]">
    <div className="flex items-center gap-3 text-muted-foreground">
      <Loader2 className="w-5 h-5 animate-spin" />
      <span>Loading analyzer...</span>
    </div>
  </section>
);

const Index = () => {
  return (
    <main className="min-h-screen bg-background">
      <HeroSection />
      <SystemGuide />
      <Suspense fallback={<AnalyzerFallback />}>
        <AIAnalyzer />
      </Suspense>
      <TemplateSection />
      <Footer />
    </main>
  );
};

export default Index;
