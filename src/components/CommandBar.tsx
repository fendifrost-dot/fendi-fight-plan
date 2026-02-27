import { useState } from "react";
import { Send, Sparkles, CreditCard, Megaphone } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Toggle } from "@/components/ui/toggle";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type AIContext = "credit" | "marketing";

interface CommandBarProps {
  className?: string;
}

const CommandBar = ({ className }: CommandBarProps) => {
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [context, setContext] = useState<AIContext>("credit");
  const [lastResponse, setLastResponse] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    setIsLoading(true);
    setLastResponse(null);

    try {
      const { data, error } = await supabase.functions.invoke("google-ai-handler", {
        body: { prompt: input.trim(), context },
      });

      if (error) throw error;

      setLastResponse(data.content);
      toast.success(`Response via ${data.provider} (${data.model})`);
    } catch (err: any) {
      console.error("Command bar error:", err);
      toast.error(err.message || "Failed to process command");
    } finally {
      setIsLoading(false);
      setInput("");
    }
  };

  return (
    <div className={`w-full border-b border-border bg-card/60 backdrop-blur-sm ${className || ""}`}>
      <div className="container mx-auto px-4 py-3">
        <form onSubmit={handleSubmit} className="flex items-center gap-3">
          <Sparkles className="w-5 h-5 text-primary shrink-0" />

          {/* Context toggle */}
          <div className="flex items-center gap-1 shrink-0">
            <Toggle
              pressed={context === "credit"}
              onPressedChange={() => setContext("credit")}
              size="sm"
              className="data-[state=on]:bg-primary/10 data-[state=on]:text-primary"
              aria-label="Credit mode"
            >
              <CreditCard className="w-3.5 h-3.5 mr-1" />
              Credit
            </Toggle>
            <Toggle
              pressed={context === "marketing"}
              onPressedChange={() => setContext("marketing")}
              size="sm"
              className="data-[state=on]:bg-accent/80 data-[state=on]:text-accent-foreground"
              aria-label="Marketing mode"
            >
              <Megaphone className="w-3.5 h-3.5 mr-1" />
              Marketing
            </Toggle>
          </div>

          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              context === "credit"
                ? "e.g. Generate a dispute letter for Equifax charge-off..."
                : "e.g. Draft a Facebook post for our spring campaign..."
            }
            className="flex-1 bg-background/50"
            disabled={isLoading}
          />

          <Button type="submit" size="sm" disabled={isLoading || !input.trim()}>
            <Send className="w-4 h-4" />
          </Button>
        </form>

        {/* Response preview */}
        {lastResponse && (
          <div className="mt-3 p-3 rounded-lg bg-muted/50 border border-border text-sm text-foreground whitespace-pre-wrap max-h-48 overflow-y-auto">
            {lastResponse}
          </div>
        )}
      </div>
    </div>
  );
};

export default CommandBar;
