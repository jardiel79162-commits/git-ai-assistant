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
    /^src\/styles\/.+\.(css|scss|less)$/,
    /^(package\.json|README\.md|tsconfig\.json|vite\.config\.\w+)$/,
  ];

  const paths = files.map((f: any) => f.path);
  const selected: string[] = [];

  for (const pattern of priority) {
    for (const p of paths) {
      if (pattern.test(p) && !selected.includes(p)) {
        selected.push(p);
      }
    }
    if (selected.length >= 15) break;
  }

  return selected.slice(0, 15);
}

function extractJsonArray(text: string): any[] | null {
  // Try direct parse first
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
  } catch {}

  // Remove markdown code fences
  const cleaned = text.replace(/```(?:json)?\s*/g, "").replace(/```\s*/g, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed;
  } catch {}

  // Try to find JSON array in the text
  const match = cleaned.match(/\[[\s\S]*\]/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      if (Array.isArray(parsed)) return parsed;
    } catch {}
  }

  return null;
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

    // Fetch content of main files in parallel
    const fileResults = await Promise.all(
      mainFiles.map(async (path) => {
        const content = await fetchFileContent(owner, repo, path, token);
        return content ? { path, content } : null;
      })
    );
    const fileContents = fileResults.filter(Boolean) as { path: string; content: string }[];

    // Build prompt for AI
    const fileContext = fileContents
      .map((f) => `--- ${f.path} ---\n${f.content}`)
      .join("\n\n");

    const systemPrompt = `Você é um programador especialista que modifica código de repositórios GitHub.

REGRAS OBRIGATÓRIAS:
1. Você DEVE SEMPRE responder com um JSON array válido. NUNCA responda com texto explicativo.
2. Cada objeto do array deve ter exatamente: {"file": "caminho/arquivo", "content": "conteúdo completo"}
3. Se a instrução pede uma mudança, você DEVE fazer a mudança. Nunca diga que não há alterações quando o usuário pediu algo.
4. MANTENHA todas as alterações anteriores da conversa. Nunca desfaça mudanças a menos que o usuário peça.
5. Inclua o conteúdo COMPLETO do arquivo, não apenas trechos.
6. Pode modificar MÚLTIPLOS arquivos de uma vez.
7. Se precisar criar um novo arquivo, crie-o.

FORMATO DA RESPOSTA (OBRIGATÓRIO):
[{"file": "src/App.tsx", "content": "conteúdo completo aqui"}]

Se realmente não houver nada para alterar, retorne: [{"file": "README.md", "content": "conteúdo atual"}] com uma mudança mínima explicando.

NUNCA retorne [] vazio. SEMPRE faça a modificação pedida.

Arquivos do repositório:
${fileContext}

Lista completa de arquivos: ${tree.map((t: any) => t.path).join(", ")}`;

    // Build conversation messages
    const aiMessages: { role: string; content: string }[] = [
      { role: "system", content: systemPrompt },
    ];

    if (conversationHistory && Array.isArray(conversationHistory)) {
      for (const msg of conversationHistory) {
        if (msg.role === "user") {
          aiMessages.push({ role: "user", content: msg.content });
        } else if (msg.role === "assistant") {
          if (msg.files && msg.files.length > 0) {
            aiMessages.push({
              role: "assistant",
              content: JSON.stringify(msg.files),
            });
          } else {
            aiMessages.push({ role: "assistant", content: msg.content });
          }
        }
      }
    }

    aiMessages.push({ role: "user", content: instruction });

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY não configurada");

    // Call AI with retry
    let files: { file: string; content: string }[] = [];
    let lastError = "";

    for (let attempt = 0; attempt < 2; attempt++) {
      const messagesForAttempt = attempt === 0
        ? aiMessages
        : [
            ...aiMessages,
            {
              role: "user",
              content: "Sua resposta anterior não era um JSON válido. Responda APENAS com um JSON array válido no formato [{\"file\": \"caminho\", \"content\": \"conteúdo\"}]. Sem texto, sem markdown, APENAS JSON.",
            },
          ];

      const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: messagesForAttempt,
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
      const aiContent = aiData.choices?.[0]?.message?.content || "";

      console.log(`Attempt ${attempt + 1} - AI response length: ${aiContent.length}`);

      const parsed = extractJsonArray(aiContent);
      if (parsed && parsed.length > 0) {
        files = parsed
          .filter((f: any) => (f.file || f.path) && f.content)
          .map((f: any) => ({ file: f.file || f.path, content: f.content }));
        if (files.length > 0) break;
      }

      lastError = aiContent.substring(0, 200);
      console.log(`Attempt ${attempt + 1} failed to parse. Preview: ${lastError}`);
    }

    if (files.length === 0) {
      console.error("All attempts failed. Last response:", lastError);
      return new Response(JSON.stringify({
        files: [],
        message: "⚠️ A IA teve dificuldade em processar sua instrução. Tente reformular o pedido de forma mais específica, mencionando o arquivo que deseja alterar.",
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      files,
      message: `Preparei ${files.length} arquivo(s) para modificação. Revise e confirme o commit.`,
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
