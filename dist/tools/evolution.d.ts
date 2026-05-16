import type { Tool } from '@modelcontextprotocol/sdk/types.js';
export declare const evolutionTools: Tool[];
type Args = Record<string, unknown>;
export declare function handleEvolutionTool(name: string, args: Args): Promise<string>;
export {};
