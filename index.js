#!/usr/bin/env node

import { configDotenv } from "dotenv";
import fetch from "node-fetch";
import fs from "fs/promises";
import path from "path";
import { execFile } from "child_process";
import { program } from "commander";

configDotenv({ path: path.join(process.env.HOME, ".prbot") });

async function getToken() {
  const url = process.env.KC_URL;
  const payload = new URLSearchParams();

  payload.append("username", process.env.KC_USER);
  payload.append("password", process.env.KC_PASSWORD);
  payload.append("client_id", process.env.KC_ID);
  payload.append("client_secret", process.env.KC_SECRET);
  payload.append("grant_type", "password");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: payload.toString(),
  });

  const json = await response.json();
  return json.access_token;
}

async function getFiles(module_name, token) {
  const url = `${process.env.RIP_URL}/ir.model/xml_prbot`;
  const body = JSON.stringify({ module_name });
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  const response = await fetch(url, { method: "POST", body, headers });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return await response.json();
}

async function main(module_name) {
  const token = await getToken();
  const files = await getFiles(module_name, token);

  let ADDONS_PATH = process.env.ADDONS_PATH;
  if (ADDONS_PATH.startsWith("~")) {
    ADDONS_PATH = ADDONS_PATH.replace("~", process.env.HOME);
  }

  // Create out directory

  // Write files temporarily and process them
  for (const file of files) {
    const buffer = Buffer.from(file.data, "base64");

    // Read and process the file
    let content = buffer.toString();

    // Remove the last two lines
    const lines = content.split("\n");
    if (lines.length > 2) {
      lines.splice(-2);
    }
    content = lines.join("\n");

    // Remove the bpmn_diagram field pattern
    content = content.replace(
      /<field name="bpmn_diagram"><!\[CDATA\[[\s\S]*?\]\]><\/field>/g,
      "",
    );

    // Determine the destination path based on filename
    let destPath;
    if (file.name.includes("Relazioni mancanti")) {
      destPath = `${ADDONS_PATH}/config/${module_name}/data/workflow_missing_relations.xml`;
    } else {
      destPath = `${ADDONS_PATH}/config/${module_name}/data/workflow_configuration.xml`;
    }

    // Create destination directory if needed
    await fs.mkdir(path.dirname(destPath), { recursive: true });

    // Write the processed file
    await fs.writeFile(destPath, content);
    console.log(`Processed: ${file.name} -> ${destPath}`);
  }

  // Git operations
  const workflowDir = path.join(ADDONS_PATH, "config", module_name, "data");
  const filesToAdd = [
    path.join(workflowDir, "workflow_missing_relations.xml"),
    path.join(workflowDir, "workflow_configuration.xml"),
  ];

  // Add files to git
  for (const filePath of filesToAdd) {
    await new Promise((resolve, reject) => {
      execFile("git", ["add", filePath], { cwd: ADDONS_PATH }, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  // Commit changes
  const commitMessage = `[IMP][${module_name}] Update workflow`;
  await new Promise((resolve, reject) => {
    execFile(
      "git",
      ["commit", "-m", commitMessage],
      { cwd: ADDONS_PATH },
      (error) => {
        if (error) reject(error);
        else resolve();
      },
    );
  });

  console.log(`Committed with message: ${commitMessage}`);
}

async function verbot(module_name, level) {
  if (!["major", "minor", "patch"].includes(level)) {
    throw new Error("Level must be one of major, minor, patch");
  }

  let ADDONS_PATH = process.env.ADDONS_PATH;
  if (ADDONS_PATH.startsWith("~")) {
    ADDONS_PATH = ADDONS_PATH.replace("~", process.env.HOME);
  }

  // Try to find manifest file in either location
  let manifestPath = path.join(ADDONS_PATH, module_name, "__manifest__.py");
  try {
    await fs.access(manifestPath);
  } catch {
    manifestPath = path.join(
      ADDONS_PATH,
      "config",
      module_name,
      "__manifest__.py",
    );
    try {
      await fs.access(manifestPath);
    } catch {
      throw new Error(`__manifest__.py not found for module ${module_name}`);
    }
  }

  // Read the manifest file
  const content = await fs.readFile(manifestPath, "utf-8");

  // Find and increment version
  const versionMatch = content.match(/"version":\s*"(15\.0\.\d+\.\d+\.\d+)"/);
  if (!versionMatch) {
    throw new Error("Version not found in manifest");
  }

  const currentVersion = versionMatch[1];
  const parts = currentVersion.split(".");
  const base = `${parts[0]}.${parts[1]}`;
  const major = parseInt(parts[2]);
  const minor = parseInt(parts[3]);
  const patch = parseInt(parts[4]);

  let newVersion;
  if (level === "patch") {
    newVersion = `${base}.${major}.${minor}.${patch + 1}`;
  } else if (level === "minor") {
    newVersion = `${base}.${major}.${minor + 1}.0`;
  } else if (level === "major") {
    newVersion = `${base}.${major + 1}.0.0`;
  }

  // Replace only the version line
  const newContent = content.replace(
    `"version": "${currentVersion}"`,
    `"version": "${newVersion}"`,
  );

  // Write back the manifest
  await fs.writeFile(manifestPath, newContent);
  console.log(`Updated version: ${currentVersion} -> ${newVersion}`);

  // Git add and commit
  await new Promise((resolve, reject) => {
    execFile("git", ["add", manifestPath], { cwd: ADDONS_PATH }, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });

  const commitMessage = `[VER][${module_name}] Bump`;
  await new Promise((resolve, reject) => {
    execFile(
      "git",
      ["commit", "-m", commitMessage],
      { cwd: ADDONS_PATH },
      (error) => {
        if (error) reject(error);
        else resolve();
      },
    );
  });

  console.log(`Committed with message: ${commitMessage}`);
}

program
  .command("pr")
  .option("-m, --module <module>")
  .option("-b, --bump <level>")
  .action((opts) => {
    if (!opts.module) {
      throw new Error("No module specified");
    }
    main(opts.module)
      .then(() => {
        if (opts.bump) {
          return verbot(opts.module, opts.bump);
        }
      })
      .catch((err) => {
        throw err;
      });
  });

program
  .command("ver")
  .option("-m, --module <module>")
  .option("-b, --bump <level>")
  .action((opts) => {
    if (!opts.module || !opts.bump) {
      throw new Error("No module or level specified");
    }
    verbot(opts.module, opts.bump);
  });

program.parse();
