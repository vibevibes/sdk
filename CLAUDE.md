# @vibevibes/sdk

The authoring primitives for vibevibes experiences. Pure types and helpers — no runtime, no server.

## Structure

```
src/
  index.ts     Barrel export
  types.ts     Type definitions
  define.ts    defineExperience, defineTool, defineTest, defineStream
  chat.ts      createChatTools (server-side tool factory)
```

## Build

```bash
npm run build    # tsup → dist/
npm test         # vitest
```

## Protocols

- This is the contract. Everything else (runtime, CLI) depends on this.
- Fix root causes, never symptoms.
- Bias to action — don't ask, just do it.
