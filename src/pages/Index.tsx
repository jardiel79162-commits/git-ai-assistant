import { useState } from "react";
import ConnectForm from "@/components/ConnectForm";
import ChatInterface from "@/components/ChatInterface";

const Index = () => {
  const [connection, setConnection] = useState<{ repoUrl: string; token: string } | null>(null);

  if (connection) {
    return (
      <ChatInterface
        repoUrl={connection.repoUrl}
        token={connection.token}
        onDisconnect={() => setConnection(null)}
      />
    );
  }

  return <ConnectForm onConnected={(repoUrl, token) => setConnection({ repoUrl, token })} />;
};

export default Index;
