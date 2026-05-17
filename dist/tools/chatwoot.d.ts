import type { Tool } from '@modelcontextprotocol/sdk/types.js';
type Args = Record<string, unknown>;
export declare const chatwootTools: Tool[];
export declare function handleChatwootTool(name: string, args: Args): Promise<string>;
export {};
