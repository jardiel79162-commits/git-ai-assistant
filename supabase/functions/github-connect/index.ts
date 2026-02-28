import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { repoUrl, token } = await req.json();

    if (!repoUrl || !token) {
      return new Response(JSON.stringify({ error: "repoUrl e token são obrigatórios" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Extract owner/repo from URL
    const match = repoUrl.match(/github\.com\/([\w.-]+)\/([\w.-]+)/);
    if (!match) {
      return new Response(JSON.stringify({ error: "URL do repositório inválida" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const [, owner, repo] = match;
    const repoName = repo.replace(/\.git$/, "");

    // Validate token by fetching repo info
    const ghResp = await fetch(`https://api.github.com/repos/${owner}/${repoName}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "DevAI-Git-Editor",
      },
    });

    if (!ghResp.ok) {
      const ghError = await ghResp.text();
      console.error("GitHub API error:", ghResp.status, ghError);
      return new Response(JSON.stringify({ error: "Token inválido ou repositório não encontrado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const repoData = await ghResp.json();

    return new Response(JSON.stringify({
      success: true,
      repo: repoData.full_name,
      defaultBranch: repoData.default_branch,
      private: repoData.private,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("github-connect error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Erro desconhecido" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
