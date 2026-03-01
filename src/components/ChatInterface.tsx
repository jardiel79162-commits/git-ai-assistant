import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Send, Loader2, Terminal, GitCommit, LogOut, Check, X, Paperclip, FileIcon, ImageIcon, Film } from "lucide-react";
import { toast } from "sonner";
import CodePreview from "./CodePreview";
import MessageBubble from "./MessageBubble";

export interface Attachment {
  name: string;
  type: string;
  size: number;
  dataUrl: string;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  files?: { file: string; content: string }[];
  attachments?: Attachment[];
  commitStatus?: "pending" | "committed" | "error";
  commitSha?: string;
}

interface ChatInterfaceProps {
  repoUrl: string;
  token: string;
  onDisconnect: () => void;
}

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/github-chat`;
const MAX_FILE_SIZE = 10 * 1024 * 1024;

function getChatStorageKey(repoUrl: string) {
  return `devai-chat-${repoUrl}`;
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(type: string) {
  if (type.startsWith("image/")) return <ImageIcon className="w-4 h-4" />;
  if (type.startsWith("video/")) return <Film className="w-4 h-4" />;
  return <FileIcon className="w-4 h-4" />;
}

const ChatInterface = ({ repoUrl, token, onDisconnect }: ChatInterfaceProps) => {
  const [messages, setMessages] = useState<Message[]>(() => {
    try {
      const saved = localStorage.getItem(getChatStorageKey(repoUrl));
      if (saved) return JSON.parse(saved);
    } catch {}
    return [];
  });
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<{ file: string; content: string }[] | null>(null);
  const [pendingInstruction, setPendingInstruction] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const repoName = repoUrl.replace("https://github.com/", "");

  // Save messages to localStorage whenever they change
  useEffect(() => {
    // Save without attachments dataUrl to avoid localStorage size limits
    const toSave = messages.map((m) => ({
      ...m,
      attachments: m.attachments?.map((a) => ({ ...a, dataUrl: "" })),
    }));
    try {
      localStorage.setItem(getChatStorageKey(repoUrl), JSON.stringify(toSave));
    } catch {
      // localStorage full - silently fail
    }
  }, [messages, repoUrl]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    Array.from(files).forEach((file) => {
      if (file.size > MAX_FILE_SIZE) {
        toast.error(`${file.name} excede o limite de 10MB`);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const attachment: Attachment = {
          name: file.name,
          type: file.type || "application/octet-stream",
          size: file.size,
          dataUrl: reader.result as string,
        };
        setAttachments((prev) => [...prev, attachment]);
      };
      reader.readAsDataURL(file);
    });

    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  // Build conversation history for AI context (without file contents to save tokens on older messages)
  const buildConversationHistory = useCallback(() => {
    return messages.map((m) => ({
      role: m.role,
      content: m.content,
      files: m.files,
    }));
  }, [messages]);

  const sendMessage = async () => {
    const trimmed = input.trim();
    if ((!trimmed && attachments.length === 0) || isLoading) return;

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmed,
      attachments: attachments.length > 0 ? [...attachments] : undefined,
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    const currentAttachments = [...attachments];
    setAttachments([]);
    setIsLoading(true);

    try {
      let finalInstruction = trimmed;
      if (currentAttachments.length > 0) {
        const fileDescriptions = currentAttachments
          .map((a) => `[Arquivo anexado: ${a.name} (${a.type}, ${formatFileSize(a.size)})]`)
          .join("\n");
        finalInstruction = `${trimmed}\n\nArquivos anexados:\n${fileDescriptions}`;
      }

      const resp = await fetch(CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          repoUrl,
          token,
          instruction: finalInstruction,
          conversationHistory: buildConversationHistory(),
        }),
      });

      if (resp.status === 429) { toast.error("Muitas requisições. Aguarde um momento."); setIsLoading(false); return; }
      if (resp.status === 402) { toast.error("Créditos insuficientes."); setIsLoading(false); return; }
      if (!resp.ok) { const t = await resp.text(); throw new Error(t); }

      const data = await resp.json();

      if (data.files && data.files.length > 0) {
        setPendingFiles(data.files);
        setPendingInstruction(trimmed);
        const assistantMsg: Message = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: data.message || `Encontrei ${data.files.length} arquivo(s) para modificar. Revise as alterações abaixo e confirme o commit.`,
          files: data.files,
          commitStatus: "pending",
        };
        setMessages((prev) => [...prev, assistantMsg]);
      } else {
        const assistantMsg: Message = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: data.message || "Não encontrei alterações necessárias.",
        };
        setMessages((prev) => [...prev, assistantMsg]);
      }
    } catch (e: any) {
      toast.error(e.message || "Erro ao processar");
      const errMsg: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "❌ Ocorreu um erro ao processar sua solicitação. Tente novamente.",
      };
      setMessages((prev) => [...prev, errMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  const confirmCommit = async () => {
    if (!pendingFiles) return;
    setIsLoading(true);

    try {
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/github-commit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          repoUrl,
          token,
          files: pendingFiles,
          commitMessage: `DevAI: ${pendingInstruction}`,
        }),
      });

      if (!resp.ok) throw new Error(await resp.text());
      const data = await resp.json();

      setMessages((prev) =>
        prev.map((m) =>
          m.commitStatus === "pending"
            ? { ...m, commitStatus: "committed" as const, commitSha: data.sha }
            : m
        )
      );
      setPendingFiles(null);
      toast.success(`Commit realizado: ${data.sha?.substring(0, 7)}`);
    } catch (e: any) {
      toast.error(e.message || "Erro ao fazer commit");
      setMessages((prev) =>
        prev.map((m) =>
          m.commitStatus === "pending" ? { ...m, commitStatus: "error" as const } : m
        )
      );
    } finally {
      setIsLoading(false);
    }
  };

  const cancelCommit = () => {
    setPendingFiles(null);
    setMessages((prev) =>
      prev.map((m) =>
        m.commitStatus === "pending"
          ? { ...m, commitStatus: undefined, content: m.content + "\n\n_Alteração cancelada pelo usuário._" }
          : m
      )
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-border bg-card/80 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <Terminal className="w-5 h-5 text-primary" />
          <div>
            <h1 className="text-sm font-semibold text-foreground">DevAI Git Editor</h1>
            <p className="text-xs text-muted-foreground font-mono">{repoName}</p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onDisconnect} className="text-muted-foreground hover:text-destructive">
          <LogOut className="w-4 h-4 mr-1" /> Desconectar
        </Button>
      </header>

      {/* Messages */}
      <ScrollArea className="flex-1 p-4">
        <div className="max-w-3xl mx-auto space-y-4">
          {messages.length === 0 && (
            <div className="text-center py-20 animate-fade-in">
              <Terminal className="w-12 h-12 text-primary/30 mx-auto mb-4" />
              <p className="text-muted-foreground">Envie uma instrução para começar a programar com IA</p>
              <p className="text-xs text-muted-foreground/60 mt-2">Ex: "Adicione um botão de login na tela inicial"</p>
            </div>
          )}

          {messages.map((msg) => (
            <div key={msg.id} className="animate-fade-in">
              <MessageBubble message={msg} />

              {msg.attachments && msg.attachments.length > 0 && (
                <div className={`flex flex-wrap gap-2 mt-2 ${msg.role === "user" ? "justify-end" : ""}`}>
                  {msg.attachments.map((att, i) => (
                    <div key={i} className="flex items-center gap-2 bg-secondary/80 border border-border rounded-lg px-3 py-2 text-xs">
                      {getFileIcon(att.type)}
                      <span className="text-foreground truncate max-w-[120px]">{att.name}</span>
                      <span className="text-muted-foreground">{formatFileSize(att.size)}</span>
                    </div>
                  ))}
                </div>
              )}

              {msg.files && msg.files.length > 0 && (
                <div className="mt-3 space-y-2">
                  {msg.files.map((f, i) => (
                    <CodePreview key={i} fileName={f.file} code={f.content} />
                  ))}
                  {msg.commitStatus === "pending" && (
                    <div className="flex gap-2 mt-3">
                      <Button onClick={confirmCommit} disabled={isLoading} size="sm" className="bg-success hover:bg-success/90 text-success-foreground">
                        <Check className="w-4 h-4 mr-1" /> Confirmar Commit
                      </Button>
                      <Button onClick={cancelCommit} disabled={isLoading} variant="outline" size="sm" className="border-destructive/50 text-destructive hover:bg-destructive/10">
                        <X className="w-4 h-4 mr-1" /> Cancelar
                      </Button>
                    </div>
                  )}
                  {msg.commitStatus === "committed" && (
                    <div className="flex items-center gap-2 text-success text-sm mt-2">
                      <GitCommit className="w-4 h-4" />
                      <span>Commit: <code className="font-mono text-xs">{msg.commitSha?.substring(0, 7)}</code></span>
                    </div>
                  )}
                  {msg.commitStatus === "error" && (
                    <p className="text-destructive text-sm mt-2">❌ Erro ao fazer commit</p>
                  )}
                </div>
              )}
            </div>
          ))}

          {isLoading && (
            <div className="flex items-center gap-3 animate-fade-in">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                <Loader2 className="w-4 h-4 text-primary animate-spin" />
              </div>
              <div className="bg-card border border-border rounded-xl px-4 py-3">
                <span className="text-sm text-muted-foreground cursor-blink">Processando</span>
              </div>
            </div>
          )}
          <div ref={scrollRef} />
        </div>
      </ScrollArea>

      {/* Attachments bar */}
      {attachments.length > 0 && (
        <div className="border-t border-border px-4 py-2 bg-card/60">
          <div className="max-w-3xl mx-auto flex flex-wrap gap-2">
            {attachments.map((att, i) => (
              <div key={i} className="flex items-center gap-2 bg-secondary border border-border rounded-lg px-3 py-1.5 text-xs">
                {getFileIcon(att.type)}
                <span className="text-foreground truncate max-w-[100px]">{att.name}</span>
                <button onClick={() => removeAttachment(i)} className="text-muted-foreground hover:text-destructive transition-colors">
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <div className="border-t border-border p-4 bg-card/80 backdrop-blur-sm">
        <div className="max-w-3xl mx-auto flex gap-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,video/*,.zip,.rar,.7z,.tar,.gz,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.json,.xml,.js,.ts,.tsx,.jsx,.py,.java,.cpp,.c,.go,.rs,.html,.css,.scss,.md"
            onChange={handleFileSelect}
            className="hidden"
          />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => fileInputRef.current?.click()}
            className="shrink-0 h-auto aspect-square text-muted-foreground hover:text-primary rounded-xl"
            title="Anexar arquivo"
          >
            <Paperclip className="w-4 h-4" />
          </Button>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Descreva a alteração que deseja no código..."
            rows={1}
            className="flex-1 resize-none bg-secondary border border-border rounded-xl px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
          />
          <Button
            onClick={sendMessage}
            disabled={isLoading || (!input.trim() && attachments.length === 0)}
            size="icon"
            className="h-auto aspect-square bg-primary text-primary-foreground hover:bg-primary/90 rounded-xl"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ChatInterface;
