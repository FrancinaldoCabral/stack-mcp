import type { Tool } from '@modelcontextprotocol/sdk/types.js';
export declare const coolifyTools: Tool[];
type Args = Record<string, unknown>;
export declare function handleCoolifyTool(name: string, args: Args): Promise<string>;
export {};
