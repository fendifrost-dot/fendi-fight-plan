import { Scale } from "lucide-react";

const Footer = () => {
  return (
    <footer className="py-12 px-4 border-t border-border/30 bg-card/30">
      <div className="max-w-4xl mx-auto">
        <div className="flex flex-col items-center text-center gap-4">
          <div className="flex items-center gap-3">
            <Scale className="w-6 h-6 text-primary" />
            <span className="text-xl font-serif font-semibold text-gold-gradient">
              Continuum Capital Group Credit Dispute System™
            </span>
          </div>
          
          <p className="text-sm text-muted-foreground max-w-lg">
            This system is for educational purposes only and does not constitute legal advice. 
            Consult with a licensed attorney for specific legal questions.
          </p>
          
          <div className="flex items-center gap-6 text-sm text-muted-foreground/70 mt-4">
            <a href="#system" className="hover:text-primary transition-colors">The System</a>
            <a href="#ai-tool" className="hover:text-primary transition-colors">AI Analyzer</a>
            <a href="#templates" className="hover:text-primary transition-colors">Templates</a>
          </div>
          
          <p className="text-xs text-muted-foreground/50 mt-6">
            © {new Date().getFullYear()} Continuum Capital Group Credit Dispute System. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
