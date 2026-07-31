# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a TypeScript-based backend service called "fridgeezy-backend": an Nx monorepo serving an Express API on port 8000 that powers the Fridgeezy React Native app's AI features — recipe suggestions, generation, composition, modification, difficulty escalation, chat, and ingredient extraction. Routes live under `/rest` and most stream their responses over SSE.

## Build Commands

```bash
# Build the TypeScript project
npm run build

# The compiled output goes to the dist/ directory
```

## Architecture

### Core Dependencies
- `express`: HTTP server
- `openai`: OpenAI API client (chat + recipe generation)
- `@google/genai`: image generation
- `zod`: Schema validation

### Project Structure
- **apps/**: Entry points for apps
- **libs/**: Entry points for shared libraries

### Routing
`apps/api/src/main.ts` mounts a single router: `app.use("/rest", createRestRouter())`.
`createRestRouter` (`apps/api/src/api/v1/rest`) wires the feature modules —
`/ingredients`, `/suggestions`, `/recipes`, `/chat`, plus `/health`. Each module
under `apps/api/src/modules/<name>/` owns its own routes/controller/usecases.

### Chat tool calling
`apps/api/src/modules/ai/tools` holds tool definitions (zod input/output schemas +
handler). `modules/chat` converts them to OpenAI function-calling schemas
(`convert-tools-to-openai.ts`) and executes the handlers directly — there is no
MCP server or transport in this repo.