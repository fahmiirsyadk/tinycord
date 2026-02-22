/**
 * When true, gateway and discord write to logs/ (gateway.log, gateway-messages.log, discord.log).
 * Set by passing --debug on the command line: bun src/index.tsx --debug
 */
export const isDebug = process.argv.includes("--debug");
