import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Lock, ArrowLeft, Scale, Eye, EyeOff, CheckCircle, XCircle } from "lucide-react";

const ResetPassword = () => {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [isCheckingLink, setIsCheckingLink] = useState(true);
  const [hasRecoverySession, setHasRecoverySession] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const { toast } = useToast();

  // Password strength checks
  const hasMinLength = password.length >= 8;
  const hasUppercase = /[A-Z]/.test(password);
  const hasLowercase = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const passwordsMatch = password === confirmPassword && password.length > 0;

  const isPasswordStrong = hasMinLength && hasUppercase && hasLowercase && hasNumber;
  const canSubmit = isPasswordStrong && passwordsMatch;

  useEffect(() => {
    let cancelled = false;

    const finalize = (ok: boolean, message?: string) => {
      if (cancelled) return;
      setHasRecoverySession(ok);
      if (!ok) setError(message ?? "Invalid or expired reset link. Please request a new one.");
      setIsCheckingLink(false);
    };

    const run = async () => {
      try {
        const url = new URL(window.location.href);
        const code = url.searchParams.get("code");

        const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
        const type = hashParams.get("type");
        const accessToken = hashParams.get("access_token");
        const refreshToken = hashParams.get("refresh_token");

        // PKCE flow (most common for password recovery in modern setups)
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          // Remove code from URL to prevent replays on refresh
          url.searchParams.delete("code");
          window.history.replaceState({}, document.title, url.pathname + (url.searchParams.toString() ? `?${url.searchParams.toString()}` : "") + url.hash);
          if (error) throw error;
        }

        // Implicit flow (hash tokens)
        if (!code && type === "recovery" && accessToken && refreshToken) {
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (error) throw error;
        }

        // Whether the library detected the session automatically or via exchange/setSession,
        // ensure we actually have a session before allowing password update.
        const { data } = await supabase.auth.getSession();
        finalize(!!data.session);
      } catch {
        finalize(false);
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!canSubmit) {
      toast({
        title: "Password requirements not met",
        description: "Please ensure your password meets all requirements",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const { error } = await supabase.auth.updateUser({
        password: password,
      });

      if (error) throw error;

      setIsSuccess(true);
      toast({
        title: "Password updated",
        description: "Your password has been successfully reset.",
      });

      // Redirect to login after 3 seconds
      setTimeout(() => {
        navigate("/auth");
      }, 3000);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to reset password";
      setError(message);
      toast({
        title: "Error",
        description: message,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const PasswordCheck = ({ passed, label }: { passed: boolean; label: string }) => (
    <div className="flex items-center gap-2 text-sm">
      {passed ? (
        <CheckCircle className="w-4 h-4 text-green-500" />
      ) : (
        <XCircle className="w-4 h-4 text-muted-foreground" />
      )}
      <span className={passed ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}>
        {label}
      </span>
    </div>
  );

  if (isSuccess) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <main className="flex-1 flex items-center justify-center p-4">
          <div className="w-full max-w-md space-y-8 text-center">
            <div className="w-20 h-20 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto">
              <CheckCircle className="w-10 h-10 text-green-600 dark:text-green-400" />
            </div>
            <h1 className="text-2xl font-serif font-bold text-foreground">
              Password Reset Successfully
            </h1>
            <p className="text-muted-foreground">
              You will be redirected to the login page in a few seconds...
            </p>
            <Button onClick={() => navigate("/auth")} variant="outline">
              Go to Login Now
            </Button>
          </div>
        </main>
      </div>
    );
  }

  if (isCheckingLink) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <main className="flex-1 flex items-center justify-center p-4">
          <div className="w-full max-w-md text-center space-y-4">
            <Loader2 className="w-8 h-8 animate-spin mx-auto text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Validating reset link…</p>
          </div>
        </main>
      </div>
    );
  }

  if (!hasRecoverySession) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <header className="p-4">
          <Button
            variant="ghost"
            onClick={() => navigate("/auth")}
            className="text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Login
          </Button>
        </header>
        <main className="flex-1 flex items-center justify-center p-4">
          <div className="w-full max-w-md space-y-8 text-center">
            <div className="w-20 h-20 bg-destructive/10 rounded-full flex items-center justify-center mx-auto">
              <XCircle className="w-10 h-10 text-destructive" />
            </div>
            <h1 className="text-2xl font-serif font-bold text-foreground">
              Invalid Reset Link
            </h1>
            <p className="text-muted-foreground">
              {error ?? "Invalid or expired reset link. Please request a new one."}
            </p>
            <Button onClick={() => navigate("/auth")} variant="default">
              Request New Reset Link
            </Button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="p-4">
        <Button
          variant="ghost"
          onClick={() => navigate("/auth")}
          className="text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Login
        </Button>
      </header>

      <main className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-md space-y-8">
          <div className="text-center">
            <div className="inline-flex items-center gap-2 text-primary mb-4">
              <Scale className="w-8 h-8" />
            </div>
            <h1 className="text-2xl font-serif font-bold text-foreground">
              Set New Password
            </h1>
            <p className="text-muted-foreground mt-2">
              Enter your new password below
            </p>
          </div>

          <div className="card-elevated rounded-2xl border border-border/50 p-6 md:p-8">
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="password" className="text-foreground">
                  New Password
                </Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pl-10 pr-10 bg-muted/30 border-border/50"
                    disabled={isLoading}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              {/* Password strength indicators */}
              {password && (
                <div className="space-y-2 p-3 bg-muted/30 rounded-lg">
                  <p className="text-sm font-medium text-foreground mb-2">Password requirements:</p>
                  <PasswordCheck passed={hasMinLength} label="At least 8 characters" />
                  <PasswordCheck passed={hasUppercase} label="One uppercase letter" />
                  <PasswordCheck passed={hasLowercase} label="One lowercase letter" />
                  <PasswordCheck passed={hasNumber} label="One number" />
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="confirmPassword" className="text-foreground">
                  Confirm New Password
                </Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="confirmPassword"
                    type={showConfirmPassword ? "text" : "password"}
                    placeholder="••••••••"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="pl-10 pr-10 bg-muted/30 border-border/50"
                    disabled={isLoading}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                  >
                    {showConfirmPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
                {confirmPassword && !passwordsMatch && (
                  <p className="text-sm text-destructive">Passwords do not match</p>
                )}
                {passwordsMatch && (
                  <p className="text-sm text-green-600 dark:text-green-400">Passwords match ✓</p>
                )}
              </div>

              <Button
                type="submit"
                disabled={isLoading || !canSubmit}
                className="w-full py-6 text-lg font-medium bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Updating Password...
                  </>
                ) : (
                  "Reset Password"
                )}
              </Button>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
};

export default ResetPassword;
