import { Scale, Shield, Gavel } from "lucide-react";

const HeroSection = () => {
  return (
    <section className="relative min-h-[60vh] flex items-center justify-center overflow-hidden py-20 px-4">
      {/* Background pattern */}
      <div className="absolute inset-0 opacity-5">
        <div className="absolute inset-0" style={{
          backgroundImage: `repeating-linear-gradient(45deg, transparent, transparent 35px, hsl(var(--gold) / 0.1) 35px, hsl(var(--gold) / 0.1) 70px)`
        }} />
      </div>
      
      {/* Glow effect */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-primary/10 rounded-full blur-[120px]" />
      
      <div className="relative z-10 max-w-4xl mx-auto text-center">
        {/* Logo icons */}
        <div className="flex items-center justify-center gap-6 mb-8">
          <Scale className="w-8 h-8 text-primary animate-fade-in" style={{ animationDelay: '0.1s' }} />
          <Shield className="w-10 h-10 text-primary animate-fade-in" style={{ animationDelay: '0.2s' }} />
          <Gavel className="w-8 h-8 text-primary animate-fade-in" style={{ animationDelay: '0.3s' }} />
        </div>
        
        {/* Title */}
        <h1 className="text-5xl md:text-7xl font-serif font-bold mb-6 animate-slide-up">
          <span className="text-gold-gradient">Credit Compass</span>
          <br />
          <span className="text-foreground">AI Dispute Analysis</span>
        </h1>
        
        {/* Subtitle */}
        <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto animate-slide-up leading-relaxed" style={{ animationDelay: '0.2s' }}>
          A response-driven dispute workflow that tells you <span className="text-foreground font-medium">exactly what to do next</span> and generates the <span className="text-primary font-medium">exact prompts</span> to use.
        </p>
        
        {/* Decorative line */}
        <div className="mt-10 flex items-center justify-center gap-4 animate-fade-in" style={{ animationDelay: '0.4s' }}>
          <div className="h-px w-16 bg-gradient-to-r from-transparent to-primary/50" />
          <div className="w-2 h-2 rounded-full bg-primary animate-glow" />
          <div className="h-px w-16 bg-gradient-to-l from-transparent to-primary/50" />
        </div>
        
        {/* Quick nav hint */}
        <div className="mt-12 flex flex-col sm:flex-row items-center justify-center gap-4 animate-slide-up" style={{ animationDelay: '0.5s' }}>
          <a 
            href="#system" 
            className="px-6 py-3 bg-primary text-primary-foreground font-medium rounded-lg hover:bg-primary/90 transition-all hover:scale-105 shadow-lg hover:shadow-primary/20"
          >
            View The System
          </a>
          <a 
            href="#ai-tool" 
            className="px-6 py-3 border border-primary/30 text-foreground font-medium rounded-lg hover:bg-primary/10 hover:border-primary/50 transition-all"
          >
            Use AI Analyzer
          </a>
        </div>
      </div>
    </section>
  );
};

export default HeroSection;
