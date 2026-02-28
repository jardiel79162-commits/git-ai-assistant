import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { GitBranch, Eye, EyeOff, Loader2, Terminal } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface ConnectFormProps {
  onConnected: (repoUrl: string, token: string) => void;
}

const ConnectForm = ({ onConnected }: ConnectFormProps) => {
  const [repoUrl, setRepoUrl] = useState("");
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [sameAccount, setSameAccount] = useState(true);
  const [loading, setLoading] = useState(false);

  const handleConnect = async () => {
    if (!repoUrl.trim() || !token.trim()) {
      toast.error("Preencha todos os campos");
      return;
    }

    const ghUrlPattern = /^https?:\/\/github\.com\/[\w.-]+\/[\w.-]+\/?$/;
    if (!ghUrlPattern.test(repoUrl.trim())) {
      toast.error("URL do repositório inválida. Use o formato: https://github.com/usuario/repo");
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("github-connect", {
        body: { repoUrl: repoUrl.trim(), token: token.trim() },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      toast.success(`Conectado ao repositório: ${data.repo}`);
      onConnected(repoUrl.trim(), token.trim());
    } catch (e: any) {
      toast.error(e.message || "Erro ao conectar ao repositório");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md animate-slide-up">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 mb-4 glow-cyan">
            <Terminal className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-3xl font-bold text-foreground tracking-tight">
            DevAI <span className="text-primary">Git Editor</span>
          </h1>
          <p className="text-muted-foreground mt-2 text-sm">
            IA programadora conectada ao GitHub
          </p>
        </div>

        {/* Form */}
        <div className="bg-card border border-border rounded-xl p-6 space-y-5 glow-cyan">
          <div className="space-y-2">
            <Label htmlFor="repo" className="text-sm text-muted-foreground">
              URL do Repositório
            </Label>
            <div className="relative">
              <GitBranch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                id="repo"
                placeholder="https://github.com/usuario/repo"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                className="pl-10 bg-secondary border-border focus:border-primary transition-colors"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="token" className="text-sm text-muted-foreground">
              Token do GitHub
            </Label>
            <div className="relative">
              <Input
                id="token"
                type={showToken ? "text" : "password"}
                placeholder="ghp_xxxxxxxxxxxx"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                className="pr-10 bg-secondary border-border focus:border-primary transition-colors font-mono text-sm"
              />
              <button
                type="button"
                onClick={() => setShowToken(!showToken)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between py-2">
            <Label htmlFor="same-account" className="text-sm text-muted-foreground cursor-pointer">
              É a mesma conta do GitHub?
            </Label>
            <Switch
              id="same-account"
              checked={sameAccount}
              onCheckedChange={setSameAccount}
            />
          </div>

          <Button
            onClick={handleConnect}
            disabled={loading}
            className="w-full h-11 bg-primary text-primary-foreground hover:bg-primary/90 font-semibold transition-all"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                Validando...
              </>
            ) : (
              "Conectar"
            )}
          </Button>

          <p className="text-xs text-muted-foreground text-center">
            Seu token é usado apenas durante a sessão e nunca é armazenado permanentemente.
          </p>
        </div>
      </div>
    </div>
  );
};

export default ConnectForm;
