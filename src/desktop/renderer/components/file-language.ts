import { StreamLanguage, type Language } from "@codemirror/language";

const languages = new Map<string, Promise<Language | null>>();

export function languageForPath(filePath: string): Promise<Language | null> {
  const extension = filePath.split(".").pop()?.toLowerCase() ?? "";
  const cached = languages.get(extension);
  if (cached) return cached;
  const language = loadLanguage(extension);
  languages.set(extension, language);
  return language;
}

async function loadLanguage(extension: string): Promise<Language | null> {
  if (["js", "jsx", "mjs", "cjs", "ts", "tsx", "mts", "cts"].includes(extension)) {
    const { javascript } = await import("@codemirror/lang-javascript");
    return javascript({ jsx: extension.includes("x"), typescript: extension.startsWith("t") }).language;
  }
  if (extension === "json") {
    return (await import("@codemirror/lang-json")).jsonLanguage;
  }
  if (extension === "py") return StreamLanguage.define((await import("@codemirror/legacy-modes/mode/python")).python);
  if (["sh", "bash", "zsh"].includes(extension)) {
    return StreamLanguage.define((await import("@codemirror/legacy-modes/mode/shell")).shell);
  }
  if (["css", "scss", "less"].includes(extension)) {
    return StreamLanguage.define((await import("@codemirror/legacy-modes/mode/css")).css);
  }
  if (["html", "htm", "xml", "svg"].includes(extension)) {
    return StreamLanguage.define((await import("@codemirror/legacy-modes/mode/xml")).html);
  }
  if (["yaml", "yml"].includes(extension)) {
    return StreamLanguage.define((await import("@codemirror/legacy-modes/mode/yaml")).yaml);
  }
  if (extension === "rs") return StreamLanguage.define((await import("@codemirror/legacy-modes/mode/rust")).rust);
  if (extension === "go") return StreamLanguage.define((await import("@codemirror/legacy-modes/mode/go")).go);
  if (["c", "h", "cc", "cpp", "cxx", "hpp", "java", "cs", "kt", "kts", "dart"].includes(extension)) {
    const mode = await import("@codemirror/legacy-modes/mode/clike");
    if (extension === "java") return StreamLanguage.define(mode.java);
    if (extension === "cs") return StreamLanguage.define(mode.csharp);
    if (extension === "kt" || extension === "kts") return StreamLanguage.define(mode.kotlin);
    if (extension === "dart") return StreamLanguage.define(mode.dart);
    return StreamLanguage.define(extension === "c" || extension === "h" ? mode.c : mode.cpp);
  }
  return null;
}
