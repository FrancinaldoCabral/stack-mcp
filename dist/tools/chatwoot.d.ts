import type { Tool } from '@modelcontextprotocol/sdk/types.js';
export declare const chatwootTools: Tool[];
type Args = Record<string, unknown>;
export declare function handleChatwootTool(name: string, args: Args): Promise<string>;
export {};
