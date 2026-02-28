import { useState } from "react";
import { ChevronDown, ChevronRight, FileCode } from "lucide-react";

interface CodePreviewProps {
  fileName: string;
  code: string;
}

const CodePreview = ({ fileName, code }: CodePreviewProps) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border border-border rounded-lg overflow-hidden bg-secondary/50">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs font-mono text-muted-foreground hover:text-foreground transition-colors"
      >
        {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        <FileCode className="w-3 h-3 text-primary" />
        <span>{fileName}</span>
        <span className="ml-auto text-muted-foreground/60">{code.split("\n").length} linhas</span>
      </button>
      {expanded && (
        <div className="border-t border-border">
          <pre className="p-3 text-xs font-mono text-foreground/80 overflow-x-auto max-h-96">
            <code>{code}</code>
          </pre>
        </div>
      )}
    </div>
  );
};

export default CodePreview;
