#!/usr/bin/env node

/**
 * Start the vibevibes dev server for an experience.
 *
 * Usage:
 *   npx vibevibes-dev              # serves from current directory
 *   npx vibevibes-dev ./my-exp     # serves from a specific path
 *   npm run dev                    # via package.json script
 */

import { resolve } from "node:path";
import { startServer } from "../dist/server.js";

const projectRoot = resolve(process.argv[2] || ".");
const port = parseInt(process.env.PORT || "4321", 10);

startServer({ projectRoot, port });
