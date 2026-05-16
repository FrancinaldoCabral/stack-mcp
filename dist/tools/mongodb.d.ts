import type { Tool } from '@modelcontextprotocol/sdk/types.js';
export declare const mongodbTools: Tool[];
type Args = Record<string, unknown>;
export declare function handleMongodbTool(name: string, args: Args): Promise<string>;
export declare function closeMongo(): Promise<void>;
export {};
