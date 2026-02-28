import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { repoUrl, token, files, commitMessage } = await req.json();

    if (!repoUrl || !token || !files || !commitMessage) {
      return new Response(JSON.stringify({ error: "Todos os campos são obrigatórios" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const match = repoUrl.match(/github\.com\/([\w.-]+)\/([\w.-]+)/);
    if (!match) throw new Error("URL inválida");
    const [, owner, repoRaw] = match;
    const repo = repoRaw.replace(/\.git$/, "");

    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
      "User-Agent": "DevAI-Git-Editor",
    };

    // Get default branch ref
    const refResp = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/ref/heads/main`, { headers });
    let branch = "main";
    let refData;
    
    if (!refResp.ok) {
      // Try master
      const masterResp = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/ref/heads/master`, { headers });
      if (!masterResp.ok) throw new Error("Não foi possível encontrar a branch principal");
      refData = await masterResp.json();
      branch = "master";
    } else {
      refData = await refResp.json();
    }

    const latestCommitSha = refData.object.sha;

    // Get the tree of the latest commit
    const commitResp = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/commits/${latestCommitSha}`, { headers });
    if (!commitResp.ok) throw new Error("Erro ao buscar commit");
    const commitData = await commitResp.json();
    const baseTreeSha = commitData.tree.sha;

    // Create blobs for each file
    const treeItems = [];
    for (const file of files) {
      const blobResp = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/blobs`, {
        method: "POST",
        headers,
        body: JSON.stringify({ content: file.content, encoding: "utf-8" }),
      });
      if (!blobResp.ok) throw new Error(`Erro ao criar blob para ${file.file}`);
      const blobData = await blobResp.json();

      treeItems.push({
        path: file.file,
        mode: "100644",
        type: "blob",
        sha: blobData.sha,
      });
    }

    // Create tree
    const treeResp = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees`, {
      method: "POST",
      headers,
      body: JSON.stringify({ base_tree: baseTreeSha, tree: treeItems }),
    });
    if (!treeResp.ok) throw new Error("Erro ao criar tree");
    const treeData = await treeResp.json();

    // Create commit
    const newCommitResp = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/commits`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        message: commitMessage,
        tree: treeData.sha,
        parents: [latestCommitSha],
      }),
    });
    if (!newCommitResp.ok) throw new Error("Erro ao criar commit");
    const newCommitData = await newCommitResp.json();

    // Update ref
    const updateRefResp = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ sha: newCommitData.sha }),
    });
    if (!updateRefResp.ok) throw new Error("Erro ao atualizar referência");

    return new Response(JSON.stringify({
      success: true,
      sha: newCommitData.sha,
      message: `Commit realizado com sucesso: ${newCommitData.sha.substring(0, 7)}`,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("github-commit error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Erro desconhecido" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
