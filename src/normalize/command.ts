import { basename } from "node:path";
import type { IdentityContext } from "./identity.js";
import type { Provider } from "../privacy/paths.js";

const PROGRAMS = new Set(["npm", "npx", "rg", "git", "node", "python", "python3", "pytest", "cargo", "go", "xcodebuild", "cat", "sed", "ls", "find", "head", "tail"]);
const SUBCOMMANDS = new Set(["test", "run", "ci", "install", "build", "check", "fmt", "lint", "status", "diff", "show", "log", "rev-parse"]);
const FLAGS = new Set(["--runInBand", "--watch", "--glob", "--type", "--fixed-strings", "--ignore-case", "--files", "--no-ignore", "--hidden", "--json", "--verbose", "--quiet", "--all", "--workspace", "--filter", "--no-cache", "--nocapture", "--only-testing", "--scheme", "--configuration", "--testPathPattern", "--exit-code", "-n", "-l", "-i", "-F", "-g", "-e", "-x", "-q"]);

export type CommandClassification = Readonly<{
  commandPattern: string;
  operationKey: string | null;
  program: string | null;
  category: "test" | "build" | "search" | "read" | "other";
  safeSimple: boolean;
  exitCodePolicy: "rg" | "git_diff" | "unknown";
}>;

function tokenize(command: string): string[] | null {
  if (command.length > 1_048_576 || /[\x00-\x1f\x7f$`]/.test(command)) return null;
  const result: string[] = [];
  let value = "";
  let quote: "'" | '"' | null = null;
  let token = false;
  for (let index = 0; index < command.length; index++) {
    const char = command[index]!;
    if (quote !== null) {
      if (char === quote) quote = null;
      else if (char === "\\" && quote === '"') {
        const next = command[++index];
        if (next === undefined) return null;
        value += next === "\\" || next === '"' ? next : "\\" + next;
      } else value += char;
      token = true;
    } else if (char === "'" || char === '"') {
      quote = char; token = true;
    } else if (char === "\\") {
      const next = command[++index];
      if (next === undefined) return null;
      value += next; token = true;
    } else if (/\s/.test(char)) {
      if (token) result.push(value);
      value = ""; token = false;
    } else if (/[;&|<>()*?{}\[\]~#]/.test(char)) return null;
    else { value += char; token = true; }
  }
  if (quote !== null) return null;
  if (token) result.push(value);
  if (!result.length || /^[A-Za-z_][A-Za-z0-9_]*=/.test(result[0]!)) return null;
  return result;
}

export function classifyCommand(
  input: unknown,
  context: IdentityContext,
  provider: Provider,
  projectIdentity: string | null,
): CommandClassification {
  const argv = typeof input === "string" ? tokenize(input)
    : Array.isArray(input) && input.length > 0 && input.length <= 4096 && input.every((part) => typeof part === "string" && !/[\0\r\n]/.test(part)) ? input as string[] : null;
  if (argv === null) return { commandPattern: "shell <complex>", operationKey: null, program: null, category: "other", safeSimple: false, exitCodePolicy: "unknown" };
  const executable = basename(argv[0]!);
  const evaluation = executable === "eval" || (["node", "nodejs"].includes(executable) && argv.some((arg) => ["-e", "--eval", "-p", "--print"].includes(arg.split("=", 1)[0]!)))
    || (["python", "python3", "sh", "bash", "zsh"].includes(executable) && argv.includes("-c"));
  if (evaluation) return { commandPattern: "shell <complex>", operationKey: null, program: null, category: "other", safeSimple: false, exitCodePolicy: "unknown" };
  const program = PROGRAMS.has(executable) ? executable : null;
  const subcommand = argv[1] && SUBCOMMANDS.has(argv[1]) ? argv[1] : null;
  const display = program ? [program] : ["other"];
  if (program && ["npm", "npx", "git", "cargo", "go"].includes(program) && subcommand) display.push(subcommand);
  let positional = false;
  let afterTerminator = false;
  for (const [index, arg] of argv.slice(1).entries()) {
    if (arg === "--" && !afterTerminator) { afterTerminator = true; continue; }
    if (index === 0 && display.includes(arg) && subcommand !== null) continue;
    const flag = arg.split("=", 1)[0]!;
    if (!afterTerminator && FLAGS.has(flag)) display.push(flag);
    else positional = true;
  }
  if (positional) display.push(subcommand === "test" ? "<target>" : "<args>");
  const category = program === "rg" || program === "find" ? "search"
    : program === "cat" || program === "sed" || program === "head" || program === "tail" ? "read"
    : program === "pytest" || (subcommand === "test" && ["npm", "cargo", "go"].includes(program ?? "")) || (program === "xcodebuild" && argv.includes("test")) ? "test"
    : subcommand === "build" && ["npm", "cargo", "go"].includes(program ?? "") ? "build" : "other";
  let diffSyntaxKnown = true;
  let exitCodeFlag = false;
  if (program === "git" && argv[1] === "diff") {
    for (const arg of argv.slice(2)) {
      if (arg === "--") break;
      if (arg === "--exit-code") exitCodeFlag = true;
      else if (arg.startsWith("-") && !["--quiet", "--no-index"].includes(arg)) diffSyntaxKnown = false;
    }
  }
  return {
    commandPattern: display.join(" "),
    operationKey: projectIdentity === null ? null : context.fingerprint("operation", [provider, projectIdentity, argv]),
    program,
    category,
    safeSimple: true,
    exitCodePolicy: program === "rg" ? "rg" : program === "git" && argv[1] === "diff" && diffSyntaxKnown && exitCodeFlag ? "git_diff" : "unknown",
  };
}
