import { useState, useEffect } from "react";
import { useKeyboard, useRenderer } from "@opentui/react";
import { discordState } from "../discord";
import { BootScreen } from "./BootScreen";
import { MainScreen } from "./MainScreen";
import { LoginScreen } from "./LoginScreen";

type Phase = "login" | "boot" | "main";

interface RootProps {
  token: string | null;
  serverWhitelist?: string;
}

/**
 * Root state machine: login -> boot -> main
 */
export function Root({ token: initialToken, serverWhitelist }: RootProps) {
  const renderer = useRenderer();
  const [phase, setPhase] = useState<Phase>(initialToken ? "boot" : "login");
  const [token, setToken] = useState<string | null>(initialToken);

  useKeyboard((key) => {
    if (key.ctrl && key.name === "c") {
      void discordState.disconnect().then(() => {
        renderer.destroy();
      });
      return false;
    }
    return true;
  });

  const [logs, setLogs] = useState<string[]>([]);
  const [readyReceived, setReadyReceived] = useState(false);
  const [firstGuildsUpdate, setFirstGuildsUpdate] = useState(false);

  useEffect(() => {
    if (token && phase === "boot") {
      discordState.connect(token);
    }
  }, [token, phase]);

  const handleToken = (newToken: string) => {
    setToken(newToken);
    setPhase("boot");
  };

  useEffect(() => {
    if (phase !== "boot") return;

    const onLog = (message: string) => {
      setLogs((prev) => [...prev, message]);
    };

    const onReady = () => {
      setReadyReceived(true);
    };

    const onGuildsUpdate = () => {
      if (!firstGuildsUpdate) {
        setFirstGuildsUpdate(true);
      }
    };

    discordState.on("log", onLog);
    discordState.on("ready", onReady);
    discordState.on("guildsUpdate", onGuildsUpdate);

    return () => {
      discordState.off("log", onLog);
      discordState.off("ready", onReady);
      discordState.off("guildsUpdate", onGuildsUpdate);
    };
  }, [phase, firstGuildsUpdate]);

  useEffect(() => {
    if (phase === "boot" && readyReceived && firstGuildsUpdate) {
      setPhase("main");
    }
  }, [phase, readyReceived, firstGuildsUpdate]);

  if (phase === "login") {
    return <LoginScreen onToken={handleToken} />;
  }

  if (phase === "boot") {
    return <BootScreen logs={logs} />;
  }

  return (
    <MainScreen
      serverWhitelist={serverWhitelist}
    />
  );
}
