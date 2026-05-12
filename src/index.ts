import { createBot } from "./bot.js";
import { requireBotToken } from "./config.js";

const runtime = createBot(requireBotToken());
const me = await runtime.bot.telegram.getMe();
runtime.setBotUsername(me.username ?? "");

const launch = runtime.bot.launch();
console.log(`[bot] @${me.username} is running`);
await launch;

const shutdown = async (signal: string): Promise<void> => {
  console.log(`[bot] ${signal}, stopping`);
  runtime.bot.stop(signal);
};

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});
process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});
