#!/usr/bin/env node

import { configDotenv } from "dotenv";
import { readdirSync, readFileSync } from "fs";
import path from "path";
import { program } from "commander";
import omelette from "omelette";
import { CONFIG_FILE, COMPLETION_SCRIPT } from "./config.js";
import { main as prMain } from "./commands/pr.js";
import { verbot } from "./commands/ver.js";
import { init } from "./commands/init.js";
import { changelog } from "./commands/changelog.js";

const completion = omelette("prbot <command> <module>");
completion.on("command", ({ reply }) => {
  reply(["pr", "ver", "init", "changelog"]);
});

completion.on("module", ({ before, reply }) => {
  if (["init", "changelog"].includes(before)) {
    reply([]);
    return;
  }
  try {
    const raw = readFileSync(CONFIG_FILE, "utf-8");
    const match = raw.match(/^ADDONS_PATH=(.+)$/m);
    if (!match) {
      reply([]);
      return;
    }
    const addonsPath = match[1].trim().replace(/^~/, process.env.HOME || "");
    reply(readdirSync(path.join(addonsPath, "config")));
  } catch {
    reply([]);
  }
});

completion.init();

const isCompletionMode =
  process.argv.includes("--compbash") || process.argv.includes("--compzsh");

if (!isCompletionMode) {
  configDotenv({ path: CONFIG_FILE });
}

program
  .command("pr <module>")
  .option("-b, --bump <level>")
  .action((module, opts) => {
    prMain(module)
      .then(() => {
        if (opts.bump) {
          return verbot(module, opts.bump);
        }
      })
      .catch((err) => {
        throw err;
      });
  });

program
  .command("ver <module>")
  .option("-b, --bump <level>")
  .action((module, opts) => {
    if (!opts.bump) {
      throw new Error("No bump level specified");
    }
    verbot(module, opts.bump);
  });

program
  .command("init")
  .description("Create config file and install shell completion")
  .action(() => {
    init(completion);
  });

program
  .command("changelog <pr>")
  .option("-t, --trident <code...>", "Trident issue codes")
  .option("-j, --jira <code...>", "JIRA issue codes")
  .option("-m, --message <text>", "Changelog entry message")
  .action((prNumber, opts) => {
    changelog(prNumber, opts).catch((err) => {
      throw err;
    });
  });

program.parse();
