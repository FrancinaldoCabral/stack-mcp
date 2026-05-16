import type { Tool } from '@modelcontextprotocol/sdk/types.js';
export declare const n8nTools: Tool[];
type Args = Record<string, unknown>;
export declare function handleN8nTool(name: string, args: Args): Promise<string>;
export {};
