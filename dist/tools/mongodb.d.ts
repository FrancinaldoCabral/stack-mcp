import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { MongoClient, type Db } from 'mongodb';
export declare function getClient(): Promise<MongoClient>;
export declare function getDb(dbName?: string): Promise<Db>;
export declare const mongodbTools: Tool[];
type Args = Record<string, unknown>;
export declare function handleMongodbTool(name: string, args: Args): Promise<string>;
export declare function closeMongo(): Promise<void>;
export {};
