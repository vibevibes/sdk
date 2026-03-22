/**
 * Experience bundler — produces server and client bundles from src/index.tsx.
 *
 * Server bundle: CJS, eval'd via new Function() to extract tools + manifest.
 * Client bundle: ESM, loaded in browser via blob URL + dynamic import().
 *
 * Extracted from create-experience/runtime/bundler.ts into @vibevibes/runtime.
 */

import * as esbuild from "esbuild";
import path from "path";
import type * as SdkModule from "@vibevibes/sdk";
import type { ToolCtx, ToolDef } from "@vibevibes/sdk";

const EXTERNALS = ["react", "react/jsx-runtime", "react-dom", "react-dom/client", "yjs", "zod", "@vibevibes/sdk", "@vibevibes/runtime"];

// Additional externals for server-only bundles — heavy rendering libraries that
// aren't needed for tool/test execution. Canvas components are never called server-side.
const SERVER_ONLY_EXTERNALS = [
  ...EXTERNALS,
  "three", "three/*",
  "@react-three/fiber", "@react-three/fiber/*",
  "@react-three/drei", "@react-three/drei/*",
];

/**
 * Strip esbuild's CJS annotation: `0 && (module.exports = {...})`.
 * Uses brace-depth counting to handle nested objects/functions in the annotation,
 * unlike a simple `[^}]*` regex which breaks on nested braces.
 */
function stripCjsAnnotation(code: string): string {
  const marker = /0\s*&&\s*\(module\.exports\s*=\s*\{/g;
  let match: RegExpExecArray | null;
  let result = code;

  while ((match = marker.exec(code)) !== null) {
    const start = match.index;
    let depth = 1; // we matched the opening `{`
    let i = match.index + match[0].length;
    while (i < code.length && depth > 0) {
      if (code[i] === "{") depth++;
      else if (code[i] === "}") depth--;
      i++;
    }
    // Skip the closing `)` and optional `;`
    if (i < code.length && code[i] === ")") i++;
    if (i < code.length && code[i] === ";") i++;
    result = result.slice(0, start) + "/* [vibevibes] stripped CJS annotation */" + result.slice(i);
    break; // Only one annotation per bundle
  }

  return result;
}

/**
 * Strip import/export statements for external packages.
 * The runtime provides these via globalThis (browser) or function args (server).
 */
/**
 * Strip external imports from a CJS server bundle so it can be eval'd with new Function().
 * Only used for server bundles — client bundles keep imports (resolved by browser import map).
 */
function stripExternalImports(code: string, externals: string[] = EXTERNALS): string {
  let result = code;
  for (const ext of externals) {
    let escaped: string;
    if (ext.endsWith("/*")) {
      const base = ext.slice(0, -2).replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&");
      escaped = `${base}\\/[^"']+`;
    } else {
      escaped = ext.replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&");
    }
    // CJS: var import_X = __toESM(require("pkg"), N); or var import_X = require("pkg");
    result = result.replace(
      new RegExp(`var\\s+\\w+\\s*=\\s*(?:__toESM\\()?require\\(["']${escaped}["']\\)[^;]{0,500};`, "g"),
      ""
    );
  }
  return result;
}

/**
 * CJS shim definitions for server-side eval (new Function()).
 * Maps esbuild-generated variable names to runtime-provided globals.
 */
const SDK_CORE_SHIM = "{ defineExperience: defineExperience, defineTool: defineTool, defineTest: defineTest, defineStream: defineStream, default: { defineExperience: defineExperience, defineTool: defineTool, defineTest: defineTest, defineStream: defineStream } }";

const CJS_BASE_SHIMS: Record<string, string> = {
  import_react: "{ default: React, __esModule: true, createElement: React.createElement, Fragment: React.Fragment, useState: React.useState, useEffect: React.useEffect, useCallback: React.useCallback, useMemo: React.useMemo, useRef: React.useRef, useContext: React.useContext, useReducer: React.useReducer, createContext: React.createContext, forwardRef: React.forwardRef, memo: React.memo }",
  import_zod: "{ z: z, default: z }",
  import_yjs: "{ default: Y }",
  import_sdk: SDK_CORE_SHIM,
  import_vibevibes_sdk: SDK_CORE_SHIM,
  import_runtime: SDK_CORE_SHIM,
  import_vibevibes_runtime: SDK_CORE_SHIM,
  import_react_dom: "{ default: {}, __esModule: true }",
  import_client: "{ default: {}, __esModule: true }",
  // Proxy stubs for rendering libraries (server-side only — Canvas is never called)
  import_three: "(new Proxy({}, { get: (_, p) => typeof p === 'string' ? function(){} : undefined }))",
  import_fiber: "(new Proxy({}, { get: (_, p) => typeof p === 'string' ? function(){} : undefined }))",
  import_drei: "(new Proxy({}, { get: (_, p) => typeof p === 'string' ? function(){} : undefined }))",
};

/**
 * Inject CJS shim variables for server-side eval.
 */
function injectCjsShims(code: string): string {
  const lines: string[] = [];

  // Emit base shims
  for (const [name, value] of Object.entries(CJS_BASE_SHIMS)) {
    lines.push(`var ${name} = ${value};`);
  }

  // Scan for numbered variants (e.g. import_react2, import_zod3) and alias them
  for (const baseName of Object.keys(CJS_BASE_SHIMS)) {
    const pattern = new RegExp(`\\b(${baseName}(\\d+))\\b`, "g");
    const seen = new Set<string>();
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(code)) !== null) {
      const numberedName = match[1];
      if (!seen.has(numberedName)) {
        seen.add(numberedName);
        lines.push(`var ${numberedName} = ${baseName};`);
      }
    }
  }

  return lines.join("\n");
}

/** Shape of an esbuild build failure (subset of esbuild.BuildFailure). */
interface EsbuildBuildFailure {
  errors?: Array<{
    text: string;
    location?: { file: string; line: number; column: number } | null;
  }>;
}

/**
 * Format esbuild errors into actionable messages with file:line and suggestions.
 */
function formatEsbuildError(err: unknown, target: string): Error {
  const buildErr = err as EsbuildBuildFailure;
  if (buildErr.errors && Array.isArray(buildErr.errors)) {
    const formatted = buildErr.errors.map((e) => {
      const loc = e.location
        ? `${e.location.file}:${e.location.line}:${e.location.column}`
        : "unknown location";
      return `  ${loc}: ${e.text}`;
    }).join("\n");
    return new Error(
      `Build failed (${target} bundle):\n${formatted}\n\n` +
      `Common fixes:\n` +
      `- Check for syntax errors at the indicated location\n` +
      `- Ensure all imports resolve to existing files in src/\n` +
      `- Verify @vibevibes/sdk imports match the available exports`
    );
  }
  return err instanceof Error ? err : new Error(String(err));
}

/**
 * Bundle for server-side tool execution (Node.js eval).
 * Returns the raw ExperienceModule extracted via new Function().
 */
export async function bundleForServer(entryPath: string): Promise<string> {
  let result: esbuild.BuildResult;
  try {
    result = await esbuild.build({
      entryPoints: [entryPath],
      bundle: true,
      format: "cjs",
      platform: "node",
      target: "es2022",
      write: false,
      external: SERVER_ONLY_EXTERNALS,
      jsx: "transform",
      jsxFactory: "React.createElement",
      jsxFragment: "React.Fragment",
      logLevel: "silent",
    });
  } catch (err: unknown) {
    throw formatEsbuildError(err, "server");
  }

  const outputFile = result.outputFiles?.[0];
  if (!outputFile) throw new Error("esbuild produced no output files for server bundle");
  let code = outputFile.text;
  code = stripExternalImports(code, SERVER_ONLY_EXTERNALS);

  // Strip user-code React hook destructuring (already provided by CJS shims)
  code = code.replace(
    /(?:const|let|var)\s+\{[^}]*?\b(?:useState|useEffect|useCallback|useMemo|useRef|useContext|useReducer)\b[^}]*?\}\s*=\s*(?:React|import_react\w*)\s*;/g,
    "/* [vibevibes] stripped duplicate React destructuring */"
  );

  // Inject CJS shims for esbuild-generated variable references
  // Pass code so we can detect numbered variants (import_react2, etc.)
  code = injectCjsShims(code) + "\n" + code;

  // Strip esbuild's CJS annotation `0 && (module.exports = {...})` — dead code that
  // causes syntax errors when module.exports is replaced with var assignment.
  // Uses brace-depth counting to handle nested objects/functions in the annotation.
  code = stripCjsAnnotation(code);

  // Replace module.exports/export default with variable assignment
  code = code.replace(
    /module\.exports\s*=\s*/g,
    "var __experience_export__ = "
  );
  code = code.replace(
    /exports\.default(?!\w)\s*=\s*/g,
    "var __experience_export__ = "
  );

  return code;
}

/**
 * Evaluate a server bundle and extract the ExperienceModule.
 */
export async function evalServerBundle(serverCode: string): Promise<unknown> {
  const sdk: typeof SdkModule = await import("@vibevibes/sdk") as typeof SdkModule;
  const { defineExperience, defineTool, defineTest, defineStream } = sdk;
  const noop = () => null;
  const stubReact = {
    createElement: noop, Fragment: "Fragment",
    useState: <T>(init?: T | (() => T)) => [typeof init === "function" ? (init as () => T)() : init, noop],
    useEffect: noop, useCallback: <T>(fn: T): T => fn,
    useMemo: <T>(fn: () => T): T => fn(), useRef: <T>(init?: T) => ({ current: init ?? null }),
    useContext: noop, useReducer: noop,
    createContext: noop, forwardRef: noop, memo: <T>(x: T): T => x,
  };
  const zodModule = await import("zod");
  const z = zodModule.z ?? zodModule.default ?? zodModule;

  const fn = new Function(
    "globalThis", "process", "global",
    "React", "Y", "z",
    "defineExperience", "defineTool", "defineTest", "defineStream",
    "require", "exports", "module", "console",
    `"use strict";\n${serverCode}\nreturn typeof __experience_export__ !== 'undefined' ? __experience_export__ : (typeof module !== 'undefined' ? module.exports : undefined);`
  );

  const fakeModule = { exports: {} };
  const sandboxGlobal = Object.create(null);
  const sandboxProcess = { env: { NODE_ENV: "production" } };
  const result = fn(
    sandboxGlobal, sandboxProcess, sandboxGlobal,
    stubReact, {}, z,
    defineExperience, defineTool, defineTest, defineStream,
    (id: string) => { throw new Error(`require('${id}') is not supported in the vibevibes server sandbox. Add '${id}' to EXTERNALS in bundler.ts.`); }, fakeModule.exports, fakeModule, console,
  );

  const exports = fakeModule.exports as Record<string, unknown>;
  return result?.default ?? result ?? exports?.default ?? exports;
}

/**
 * Bundle for client-side Canvas rendering (browser).
 * Returns pure ESM. External imports (react, zod, etc.) are left as-is —
 * the viewer's import map resolves them in the browser.
 */
export async function bundleForClient(entryPath: string): Promise<string> {
  let result: esbuild.BuildResult;
  try {
    result = await esbuild.build({
      entryPoints: [entryPath],
      bundle: true,
      format: "esm",
      platform: "browser",
      target: "es2020",
      write: false,
      external: EXTERNALS,
      jsx: "transform",
      jsxFactory: "React.createElement",
      jsxFragment: "React.Fragment",
      logLevel: "silent",
    });
  } catch (err: unknown) {
    throw formatEsbuildError(err, "client");
  }

  const clientOutputFile = result.outputFiles?.[0];
  if (!clientOutputFile) throw new Error("esbuild produced no output files for client bundle");
  return clientOutputFile.text;
}

/**
 * Build both bundles from an entry file.
 */
export async function buildExperience(entryPath: string): Promise<{ serverCode: string; clientCode: string }> {
  const [serverCode, clientCode] = await Promise.all([
    bundleForServer(entryPath),
    bundleForClient(entryPath),
  ]);
  return { serverCode, clientCode };
}

/**
 * Validate a client bundle for common issues.
 * Lightweight — esbuild already validates syntax. This just checks the output exists.
 * Returns null if OK, or an error message string.
 */
export function validateClientBundle(code: string): string | null {
  if (!code || !code.trim()) return "Client bundle is empty";
  return null;
}
