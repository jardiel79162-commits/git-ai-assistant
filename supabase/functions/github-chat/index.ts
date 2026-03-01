import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function fetchRepoTree(owner: string, repo: string, token: string, branch: string) {
  const resp = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "DevAI-Git-Editor",
      },
    }
  );
  if (!resp.ok) throw new Error("Não foi possível buscar a árvore do repositório");
  const data = await resp.json();
  return (data.tree || []).filter((t: any) => t.type === "blob");
}

async function fetchFileContent(owner: string, repo: string, path: string, token: string) {
  const resp = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "DevAI-Git-Editor",
      },
    }
  );
  if (!resp.ok) return null;
  const data = await resp.json();
  if (data.encoding === "base64" && data.content) {
    const binary = atob(data.content.replace(/\n/g, ""));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder("utf-8").decode(bytes);
  }
  return null;
}

function identifyMainFiles(files: any[]): string[] {
  const priority = [
    /^src\/(App|app|index|main)\.(tsx?|jsx?|vue)$/,
    /^(index|app|main)\.(tsx?|jsx?|html)$/,
    /^src\/pages\/.+\.(tsx?|jsx?)$/,
    /^src\/components\/.+\.(tsx?|jsx?)$/,
    /^(package\.json|README\.md)$/,
  ];

  const paths = files.map((f: any) => f.path);
  const selected: string[] = [];

  for (const pattern of priority) {
    for (const p of paths) {
      if (pattern.test(p) && !selected.includes(p)) {
        selected.push(p);
      }
    }
    if (selected.length >= 10) break;
  }

  return selected.slice(0, 10);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { repoUrl, token, instruction, conversationHistory } = await req.json();

    if (!repoUrl || !token || !instruction) {
      return new Response(JSON.stringify({ error: "repoUrl, token e instruction são obrigatórios" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const match = repoUrl.match(/github\.com\/([\w.-]+)\/([\w.-]+)/);
    if (!match) throw new Error("URL inválida");
    const [, owner, repoRaw] = match;
    const repo = repoRaw.replace(/\.git$/, "");

    // Get default branch
    const repoResp = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.v3+json", "User-Agent": "DevAI-Git-Editor" },
    });
    if (!repoResp.ok) throw new Error("Não foi possível acessar o repositório");
    const repoData = await repoResp.json();
    const branch = repoData.default_branch;

    // Fetch tree & identify files
    const tree = await fetchRepoTree(owner, repo, token, branch);
    const mainFiles = identifyMainFiles(tree);

    // Fetch content of main files
    const fileContents: { path: string; content: string }[] = [];
    for (const path of mainFiles) {
      const content = await fetchFileContent(owner, repo, path, token);
      if (content) {
        fileContents.push({ path, content });
      }
    }

    // Build prompt for AI
    const fileContext = fileContents
      .map((f) => `--- ${f.path} ---\n${f.content}`)
      .join("\n\n");

    const systemPrompt = `Você é um programador especialista. O usuário vai pedir modificações em um repositório GitHub.

REGRAS IMPORTANTES:
1. Responda APENAS com um JSON array de objetos com as alterações.
2. Cada objeto deve ter: "file" (caminho do arquivo) e "content" (conteúdo completo atualizado do arquivo).
3. Responda APENAS o JSON, sem markdown, sem explicações.
4. Se não houver alterações necessárias, retorne [].
5. MUITO IMPORTANTE: Você DEVE manter todas as alterações anteriores que foram feitas na conversa. Nunca desfaça modificações anteriores a menos que o usuário peça explicitamente.
6. Ao modificar um arquivo, inclua o conteúdo COMPLETO do arquivo com TODAS as alterações acumuladas.
7. Você pode modificar múltiplos arquivos de uma vez se necessário.

Arquivos do repositório:
${fileContext}

Lista completa de arquivos: ${tree.map((t: any) => t.path).join(", ")}`;

    // Build conversation messages for AI with full history
    const aiMessages: { role: string; content: string }[] = [
      { role: "system", content: systemPrompt },
    ];

    // Add conversation history so AI has context of all previous changes
    if (conversationHistory && Array.isArray(conversationHistory)) {
      for (const msg of conversationHistory) {
        if (msg.role === "user") {
          aiMessages.push({ role: "user", content: msg.content });
        } else if (msg.role === "assistant") {
          // For assistant messages that had file changes, include the files info
          if (msg.files && msg.files.length > 0) {
            const filesInfo = msg.files.map((f: any) => `Arquivo modificado: ${f.file}`).join("\n");
            aiMessages.push({
              role: "assistant",
              content: `Modifiquei os seguintes arquivos:\n${filesInfo}\n\n${JSON.stringify(msg.files)}`,
            });
          } else {
            aiMessages.push({ role: "assistant", content: msg.content });
          }
        }
      }
    }

    // Add current instruction
    aiMessages.push({ role: "user", content: instruction });

    // Call AI
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY não configurada");

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: aiMessages,
      }),
    });

    if (aiResp.status === 429) {
      return new Response(JSON.stringify({ error: "Rate limit excedido. Tente novamente em instantes." }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (aiResp.status === 402) {
      return new Response(JSON.stringify({ error: "Créditos insuficientes." }), {
        status: 402,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!aiResp.ok) throw new Error("Erro na API de IA");

    const aiData = await aiResp.json();
    const aiContent = aiData.choices?.[0]?.message?.content || "[]";

    // Parse JSON from AI response
    let files: { file: string; content: string }[] = [];
    try {
      const cleaned = aiContent.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed)) {
        files = parsed.map((f: any) => ({ file: f.file || f.path, content: f.content }));
      }
    } catch {
      console.error("Failed to parse AI response:", aiContent);
    }

    return new Response(JSON.stringify({
      files,
      message: files.length > 0
        ? `Preparei ${files.length} arquivo(s) para modificação. Revise e confirme o commit.`
        : "A IA não identificou alterações necessárias para esta instrução.",
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("github-chat error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Erro desconhecido" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
