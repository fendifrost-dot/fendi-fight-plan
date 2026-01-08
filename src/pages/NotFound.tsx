import { useLocation, Navigate } from "react-router-dom";
import { useEffect, useState } from "react";

const NotFound = () => {
  const location = useLocation();
  const [shouldRedirect, setShouldRedirect] = useState(false);

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
    
    // Known routes that should never show 404
    const validRoutes = ["/", "/auth", "/reset-password"];
    const isValidRoute = validRoutes.some(route => 
      location.pathname === route || location.pathname.startsWith(route + "/")
    );
    
    // If somehow we got here on a valid route, redirect
    if (isValidRoute || location.pathname === "/") {
      setShouldRedirect(true);
    }
  }, [location.pathname]);

  // Redirect to home if on a valid route (edge case handling)
  if (shouldRedirect) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="text-center max-w-md px-4">
        <h1 className="mb-4 text-6xl font-serif font-bold text-primary">404</h1>
        <p className="mb-2 text-2xl font-medium text-foreground">Page not found</p>
        <p className="mb-6 text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <a 
          href="/" 
          className="inline-flex items-center justify-center px-6 py-3 bg-primary text-primary-foreground font-medium rounded-lg hover:bg-primary/90 transition-colors"
        >
          Return to Home
        </a>
      </div>
    </div>
  );
};

export default NotFound;
