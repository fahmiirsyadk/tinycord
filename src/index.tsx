import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { discordState } from "./discord";
import { Root } from "./components/Root";
import { getToken } from "./config";

/**
 * Entry point: render immediately to show boot log
 */

const renderer = await createCliRenderer({
  exitOnCtrlC: false,
});

const cleanup = async () => {
  await discordState.disconnect();
  renderer.destroy();
  process.exit(0);
};

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

const token = getToken();
const serverWhitelist = process.argv[2] ?? undefined;
createRoot(renderer).render(
  <Root token={token} serverWhitelist={serverWhitelist} />
);
