import type { Tool } from '@modelcontextprotocol/sdk/types.js';
export declare const qdrantTools: Tool[];
type Args = Record<string, unknown>;
export declare function handleQdrantTool(name: string, args: Args): Promise<string>;
export {};
