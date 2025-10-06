import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { Building2, FileBox, Lock } from "lucide-react";
import { startAuthFlow } from "@/lib/autodesk-auth";

const Index = () => {
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Building2 className="h-6 w-6 text-primary" />
            <h1 className="text-xl font-bold text-foreground">ACC Viewer</h1>
          </div>
          <Button variant="outline" onClick={startAuthFlow}>
            Sign In with Autodesk
          </Button>
        </div>
      </header>

      {/* Hero Section */}
      <main className="flex-1 flex items-center justify-center p-4">
        <div className="max-w-4xl w-full text-center space-y-8">
          <div className="space-y-4">
            <h2 className="text-5xl font-bold text-foreground">
              View Your ACC Models
            </h2>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              Access and explore your Autodesk Construction Cloud projects in a
              powerful 3D viewer
            </p>
          </div>

          <div className="flex justify-center gap-4">
            <Button
              size="lg"
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
              onClick={() => navigate("/viewer")}
            >
              Open Viewer
            </Button>
            <Button size="lg" variant="outline">
              Learn More
            </Button>
          </div>

          {/* Features */}
          <div className="grid md:grid-cols-3 gap-6 mt-16">
            <div className="p-6 rounded-lg bg-card border border-border">
              <FileBox className="h-12 w-12 text-primary mb-4 mx-auto" />
              <h3 className="text-lg font-semibold text-foreground mb-2">
                3D Model Viewing
              </h3>
              <p className="text-sm text-muted-foreground">
                View your construction models in stunning 3D with intuitive
                controls
              </p>
            </div>
            <div className="p-6 rounded-lg bg-card border border-border">
              <Building2 className="h-12 w-12 text-primary mb-4 mx-auto" />
              <h3 className="text-lg font-semibold text-foreground mb-2">
                ACC Integration
              </h3>
              <p className="text-sm text-muted-foreground">
                Direct access to your Autodesk Construction Cloud projects
              </p>
            </div>
            <div className="p-6 rounded-lg bg-card border border-border">
              <Lock className="h-12 w-12 text-primary mb-4 mx-auto" />
              <h3 className="text-lg font-semibold text-foreground mb-2">
                Secure Access
              </h3>
              <p className="text-sm text-muted-foreground">
                Enterprise-grade security with OAuth authentication
              </p>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border bg-card py-6">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          Powered by Autodesk Forge Platform
        </div>
      </footer>
    </div>
  );
};

export default Index;
