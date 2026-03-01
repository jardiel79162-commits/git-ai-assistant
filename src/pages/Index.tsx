import { useState, useEffect } from "react";
import ConnectForm from "@/components/ConnectForm";
import ChatInterface from "@/components/ChatInterface";

const STORAGE_KEY = "devai-connection";

const Index = () => {
  const [connection, setConnection] = useState<{ repoUrl: string; token: string } | null>(null);

  // Restore connection from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.repoUrl && parsed.token) {
          setConnection(parsed);
        }
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      }
    }
  }, []);

  const handleConnect = (repoUrl: string, token: string) => {
    const conn = { repoUrl, token };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(conn));
    setConnection(conn);
  };

  const handleDisconnect = () => {
    localStorage.removeItem(STORAGE_KEY);
    setConnection(null);
  };

  if (connection) {
    return (
      <ChatInterface
        repoUrl={connection.repoUrl}
        token={connection.token}
        onDisconnect={handleDisconnect}
      />
    );
  }

  return <ConnectForm onConnected={handleConnect} />;
};

export default Index;
