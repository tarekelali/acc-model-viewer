import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { ArrowRight, User } from "lucide-react";
import { startAuthFlow } from "@/lib/autodesk-auth";
import heroImage from "@/assets/hero-building.png";

const Index = () => {
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* IKEA-Style Header */}
      <header className="bg-[hsl(209,100%,32%)]">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          {/* Left: IKEA Logo + App Name */}
          <div className="flex items-center gap-3">
            {/* IKEA Logo */}
            <svg viewBox="0 0 88 36" className="h-9 w-auto fill-[hsl(51,100%,50%)]">
              <path d="M33.6,0.9h7.4v33.7h-7.4V0.9z M9.8,0.9h7.4v14.8l12-14.8h9.6L24.2,17.2l15.8,17.4h-10L17.2,18.9v15.7H9.8V0.9z M77.3,0.9h10.2L73.8,34.6H63.6L50.1,0.9h10.1l7.3,20.4L77.3,0.9z M0,0.9h7.4v33.7H0V0.9z M77.3,0.9h10.2L73.8,34.6H63.6L50.1,0.9h10.1l7.3,20.4L77.3,0.9z" />
            </svg>
            <span className="text-lg font-semibold text-primary-foreground">M&CP Configurator</span>
          </div>
          
          {/* Right: Sign In Button */}
          <button 
            onClick={startAuthFlow}
            className="flex items-center gap-2 hover:bg-[hsl(209,100%,28%)] px-3 py-2 rounded transition-colors text-primary-foreground"
          >
            <div className="w-6 h-6 rounded-full bg-primary-foreground flex items-center justify-center">
              <User className="h-4 w-4 text-primary" />
            </div>
            <span className="font-medium">Sign in</span>
          </button>
        </div>
      </header>

      {/* Hero Section - IKEA Card Style */}
      <main className="flex-1 flex items-center justify-center p-4 md:p-8 bg-background">
        <div className="max-w-6xl w-full">
          {/* IKEA-style Hero Card */}
          <div className="grid md:grid-cols-2 rounded-lg overflow-hidden bg-card shadow-lg">
            {/* Left: Image */}
            <div className="relative aspect-square md:aspect-auto">
              <img 
                src={heroImage} 
                alt="Building floor plan" 
                className="w-full h-full object-cover"
              />
            </div>
            
            {/* Right: Content */}
            <div className="p-8 md:p-12 flex flex-col justify-center">
              {/* Label */}
              <span className="text-sm font-semibold text-primary mb-2 uppercase tracking-wide">
                Configurator
              </span>
              
              {/* Title */}
              <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold text-foreground mb-4 leading-tight">
                Update solutions
              </h1>
              
              {/* Body */}
              <p className="text-base md:text-lg text-muted-foreground mb-8 leading-relaxed">
                Navigate to your project to update a solution using the 
                configurator and sync changes.
              </p>
              
              {/* CTA Arrow Button */}
              <button 
                onClick={() => navigate("/viewer")}
                className="self-start w-14 h-14 rounded-full bg-primary 
                           flex items-center justify-center hover:bg-[hsl(209,100%,28%)]
                           transition-colors shadow-md hover:shadow-lg"
                aria-label="Go to viewer"
              >
                <ArrowRight className="h-6 w-6 text-primary-foreground" />
              </button>
            </div>
          </div>
        </div>
      </main>

      {/* Minimal Footer */}
      <footer className="bg-background border-t border-border py-6">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          Powered by IKEA Digital Solutions
        </div>
      </footer>
    </div>
  );
};

export default Index;
