import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

interface DisputeStepProps {
  stepNumber: number;
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

const DisputeStep = ({ stepNumber, title, children, defaultOpen = false }: DisputeStepProps) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="card-elevated rounded-xl border border-border/50 overflow-hidden transition-all duration-300 hover:border-primary/30">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center gap-4 p-6 text-left hover:bg-muted/30 transition-colors"
      >
        <span className="step-number flex-shrink-0">{stepNumber}</span>
        <h3 className="text-xl md:text-2xl font-serif font-semibold text-foreground flex-1">
          {title}
        </h3>
        <ChevronDown 
          className={cn(
            "w-6 h-6 text-muted-foreground transition-transform duration-300",
            isOpen && "rotate-180 text-primary"
          )} 
        />
      </button>
      
      <div className={cn(
        "overflow-hidden transition-all duration-300",
        isOpen ? "max-h-[2000px] opacity-100" : "max-h-0 opacity-0"
      )}>
        <div className="px-6 pb-6 pt-2 border-t border-border/30">
          <div className="pl-14 space-y-4 text-muted-foreground leading-relaxed">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
};

export default DisputeStep;
