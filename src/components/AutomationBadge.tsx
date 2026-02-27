import { Activity, CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface AutomationBadgeProps {
  isRunning?: boolean;
  taskLabel?: string;
}

const AutomationBadge = ({ isRunning = false, taskLabel }: AutomationBadgeProps) => {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant={isRunning ? "default" : "secondary"}
          className={`gap-1.5 cursor-default transition-colors ${
            isRunning ? "animate-pulse" : ""
          }`}
        >
          {isRunning ? (
            <Activity className="w-3 h-3" />
          ) : (
            <CheckCircle2 className="w-3 h-3" />
          )}
          {isRunning ? "Automation Running" : "Idle"}
        </Badge>
      </TooltipTrigger>
      <TooltipContent>
        {isRunning
          ? `Task: ${taskLabel || "Background processing"}`
          : "No background automations running"}
      </TooltipContent>
    </Tooltip>
  );
};

export default AutomationBadge;
