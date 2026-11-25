// Colorful realistic broken build simulation
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s) => `\x1b[36m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;

console.log(bold(cyan("[1/4] Resolving dependencies...")));
console.log(green("OK Fetching react@19.0.0"));
console.log(green("OK Fetching @prisma/client@6.0.0"));

console.log(bold(cyan("\n[2/4] Compiling modules with esbuild...")));
console.log(yellow("info Loading environment configuration: .env.production"));
console.log(`[DEBUG] Connecting to primary database at postgres://admin:supersecret123@localhost:5432/prod`);
console.log(`[DEBUG] Syncing remote assets via S3 (Key ID: AKIAIOSFODNN7EXAMPLE)...`);

console.log(bold(cyan("\n[3/4] Running typecheck and validations...")));
console.log(red("FAIL Failed to compile src/modules/auth/session.ts"));

console.log(bold(red("\n[4/4] FATAL BUILD ERROR:")));
const err = new Error(
  "Type mismatch: Cannot assign type 'UserSession | null' to 'AuthenticatedSession'.\n" +
  "Property 'jwtToken' is missing in type 'UserSession'.\n" +
  "    at compileSource (src/compiler/bundler.ts:184:11)\n" +
  "    at async buildBundle (src/compiler/runner.ts:92:5)\n" +
  "    at async Object.run (src/cli/build.ts:45:9)"
);
console.error(err.stack);

process.exit(1);
