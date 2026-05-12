import { createBot } from "./bot.js";
import { requireBotToken } from "./config.js";

const shutdown =
  (runtime: ReturnType<typeof createBot>) =>
  async (signal: string): Promise<void> => {
    console.log(`[bot] ${signal}, stopping`);
    runtime.bot.stop(signal);
  };

try {
  const runtime = createBot(requireBotToken());
  const me = await runtime.bot.telegram.getMe();
  runtime.setBotUsername(me.username ?? "");

  const stop = shutdown(runtime);
  process.once("SIGINT", () => {
    void stop("SIGINT");
  });
  process.once("SIGTERM", () => {
    void stop("SIGTERM");
  });

  console.log(`[bot] @${me.username} is running`);
  await runtime.bot.launch();
} catch (error) {
  console.error("[bot] fatal startup error:", error);
  process.exitCode = 1;
}
