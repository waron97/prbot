function resolveAddonsPath(addonsPath) {
  if (addonsPath.startsWith("~")) {
    return addonsPath.replace("~", process.env.HOME);
  }
  return addonsPath;
}

export { resolveAddonsPath };
