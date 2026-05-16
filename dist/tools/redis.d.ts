import type { Tool } from '@modelcontextprotocol/sdk/types.js';
export declare const redisTools: Tool[];
type Args = Record<string, unknown>;
export declare function handleRedisTool(name: string, args: Args): Promise<string>;
export declare function closeRedis(): Promise<void>;
export {};
