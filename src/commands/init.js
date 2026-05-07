import { readFileSync, existsSync, mkdirSync, writeFileSync, appendFileSync } from "fs";
import path from "path";
import inquirer from "inquirer";
import { CONFIG_DIR, CONFIG_FILE, COMPLETION_SCRIPT } from "../config.js";

async function init(completion) {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }

  const existing = existsSync(CONFIG_FILE)
    ? Object.fromEntries(
        readFileSync(CONFIG_FILE, "utf-8")
          .split("\n")
          .flatMap((line) => {
            const m = line.match(/^([A-Z_]+)=(.*)$/);
            return m ? [[m[1], m[2]]] : [];
          }),
      )
    : {};

  const answers = await inquirer.prompt([
    {
      type: "input",
      name: "ADDONS_PATH",
      message: "Addons path:",
      default: existing.ADDONS_PATH ?? "~/codebase/sorgenia/addons",
    },
    {
      type: "input",
      name: "KC_URL",
      message: "Keycloak URL:",
      default: existing.KC_URL ?? "",
    },
    {
      type: "input",
      name: "KC_USER",
      message: "Keycloak user:",
      default: existing.KC_USER ?? "",
    },
    {
      type: "password",
      name: "KC_PASSWORD",
      message: "Keycloak password:",
      default: existing.KC_PASSWORD ?? "",
      mask: "*",
    },
    {
      type: "input",
      name: "KC_ID",
      message: "Keycloak client ID:",
      default: existing.KC_ID ?? "",
    },
    {
      type: "input",
      name: "KC_SECRET",
      message: "Keycloak client secret:",
      default: existing.KC_SECRET ?? "",
    },
    {
      type: "input",
      name: "RIP_URL",
      message: "RIP URL:",
      default: existing.RIP_URL ?? "",
    },
  ]);

  writeFileSync(
    CONFIG_FILE,
    Object.entries(answers)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n") + "\n",
  );
  console.log(`Config written to ${CONFIG_FILE}`);

  writeFileSync(COMPLETION_SCRIPT, completion.generateCompletionCode());
  console.log(`Completion script written to ${COMPLETION_SCRIPT}`);

  const rcFile = path.join(process.env.HOME || "", ".bashrc");
  const sourceLine = `source ${COMPLETION_SCRIPT}`;
  const rcContent = existsSync(rcFile) ? readFileSync(rcFile, "utf-8") : "";
  if (!rcContent.includes(sourceLine)) {
    appendFileSync(rcFile, `\n# prbot completion\n${sourceLine}\n`);
    console.log(`Registered completion in ${rcFile} — run: source ~/.bashrc`);
  } else {
    console.log("Completion already registered in ~/.bashrc");
  }
}

export { init };
