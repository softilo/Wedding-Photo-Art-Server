// Vercel Node.js Serverless Function entry point.
// Imports the TypeScript-compiled NestJS handler from `dist/` so decorator metadata
// emitted by `tsc` is preserved reliably without bundler transform issues.
import { handleVercelRequest } from '../dist/serverless.js';

export default async function handler(req, res) {
  return handleVercelRequest(req, res);
}
