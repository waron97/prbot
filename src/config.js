import path from "path";

const CONFIG_DIR = path.join(process.env.HOME || "", ".config", "prbot");
const CONFIG_FILE = path.join(CONFIG_DIR, "config");
const COMPLETION_SCRIPT = path.join(CONFIG_DIR, "completion.sh");

export { CONFIG_DIR, CONFIG_FILE, COMPLETION_SCRIPT };
