import { Database, DatabaseLogger, EntityIdRef, ROW_ID_ATTR } from "./System.js";
import { InteractionContext } from "./Controller";
import { dbConsoleLogger } from "./MonoSystem.js";

class IDSystem {
  constructor(public db: Database) {}
  
  setup() {
    return this.db.scheme(`CREATE TABLE IF NOT EXISTS _IDS_ (last INTEGER, name TEXT)`);
  }
  
  async getAutoId(recordName: string) {
    const lastId = (
      await this.db.query<{ last: number }>(
        `SELECT last FROM _IDS_ WHERE name = '${recordName}'`,
        [],
        `finding last id of ${recordName}`
      )
    )[0]?.last;
    
    const newId = (lastId || 0) + 1;
    const name = `set last id for ${recordName}: ${newId}`;
    
    if (lastId === undefined) {
      // 使用 insert 而不是 scheme 来插入数据
      await this.db.insert(
        `INSERT INTO _IDS_ (name, last) VALUES (?, ?)`,
        [recordName, newId],
        name
      );
    } else {
      await this.db.update(
        `UPDATE _IDS_ SET last = ? WHERE name = ?`,
        [newId, recordName],
        undefined,
        name
      );
    }
    return newId as unknown as string;
  }
}

export type CloudflareD1DBOptions = { logger?: DatabaseLogger }

export class CloudflareD1DB implements Database {
  idSystem!: IDSystem;
  logger: DatabaseLogger;
  
  constructor(public d1: any, public options?: CloudflareD1DBOptions) {
    this.idSystem = new IDSystem(this);
    this.logger = this.options?.logger || dbConsoleLogger;
  }

  async checkSchemaVersionUpdate(): Promise<boolean> {
    try {
      // Check if _System_ table exists (this is always created when schema is set up)
      const result = await this.d1.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='_System_' LIMIT 1"
      ).first();
      return !result;
    } catch (error) {
      return true;
    }
  }

  async open(forceDrop?: boolean): Promise<any> {
    // D1 doesn't need explicit connection opening
    if (forceDrop) {
      console.warn("forceDrop not supported in Cloudflare D1");
    }
    await this.idSystem.setup();
    return Promise.resolve();
  }

  async scheme(sql: string, name?: string): Promise<any> {
    const logger = this.logger;
    
    logger.info({
      type: 'scheme',
      name: name || '',
      sql,
    });
    
    try {
      // D1 的 exec 方法对于某些 SQL 语句可能有问题
      // 改用 prepare().run() 来执行 DDL 语句
      const result = await this.d1.prepare(sql).run();
      return result;
    } catch (error) {
      logger.error({
        type: 'scheme',
        name: name || '',
        sql,
        error: String(error)
      });
      throw error;
    }
  }

  async query<T extends any>(
    sql: string,
    values: any[] = [],
    name?: string
  ): Promise<T[]> {
    const logger = this.logger;
    
    const params = values.map(x => x === false ? 0 : x === true ? 1 : x);
    
    logger.info({
      type: 'query',
      name: name || '',
      sql,
      params
    });
    
    try {
      const stmt =
        values.length > 0
          ? this.d1.prepare(sql).bind(...params)
          : this.d1.prepare(sql);
      const result = await stmt.all();
      return result.results as T[];
    } catch (error) {
      logger.error({
        type: 'query',
        name: name || '',
        sql,
        params,
        error: String(error)
      });
      throw error;
    }
  }

  async delete<T extends any>(
    sql: string,
    where: any[],
    name?: string
  ): Promise<T[]> {
    const logger = this.logger;
    
    const params = where.map(x => x === false ? 0 : x === true ? 1 : x);
    
    logger.info({
      type: 'delete',
      name: name || '',
      sql,
      params
    });
    
    try {
      const stmt =
        where.length > 0
          ? this.d1.prepare(sql).bind(...params)
          : this.d1.prepare(sql);
      const result = await stmt.run();
      return result as unknown as any[];
    } catch (error) {
      logger.error({
        type: 'delete',
        name: name || '',
        sql,
        params,
        error: String(error)
      });
      throw error;
    }
  }

  async insert(sql: string, values: any[], name?: string): Promise<EntityIdRef> {
    const logger = this.logger;
    
    const params = values.map(x => {
      return (typeof x === 'object' && x !== null) ? JSON.stringify(x) : x === false ? 0 : x === true ? 1 : x;
    });
    
    logger.info({
      type: 'insert',
      name: name || '',
      sql,
      params
    });
    
    try {
      // 检查是否是 _IDS_ 表的插入，如果是，不需要 RETURNING 子句
      const isIDSTable = sql.includes('_IDS_');
      const finalSQL = isIDSTable ? sql : `${sql} RETURNING ${ROW_ID_ATTR}`;
      
      const stmt =
        values.length > 0
          ? this.d1.prepare(finalSQL).bind(...params)
          : this.d1.prepare(finalSQL);
      const result = await stmt.run();
      return result as unknown as EntityIdRef;
    } catch (error) {
      logger.error({
        type: 'insert',
        name: name || '',
        sql,
        params,
        error: String(error)
      });
      throw error;
    }
  }

  async update(
    sql: string,
    values: any[],
    idField?: string,
    name?: string
  ): Promise<any[]> {
    const logger = this.logger;
    
    // 添加 RETURNING 子句，与 SQLiteDB 保持一致
    const finalSQL = `${sql} ${idField ? `RETURNING ${idField} AS id` : ''}`;
    const params = values.map(x => {
      return (typeof x === 'object' && x !== null) ? JSON.stringify(x) : x === false ? 0 : x === true ? 1 : x;
    });
    
    logger.info({
      type: 'update',
      name: name || '',
      sql: finalSQL,
      params
    });
    
    try {
      const stmt =
        values.length > 0
          ? this.d1.prepare(finalSQL).bind(...params)
          : this.d1.prepare(finalSQL);
      const result = await stmt.run();
      
      // 与 SQLiteDB 保持一致的返回格式
      return result as unknown as any[];
    } catch (error) {
      logger.error({
        type: 'update',
        name: name || '',
        sql: finalSQL,
        params,
        error: String(error)
      });
      throw error;
    }
  }

  async getAutoId(recordName: string): Promise<string> {
    return this.idSystem.getAutoId(recordName);
  }

  // SQLite/D1 不需要定义 getPlaceholder，使用系统默认的 ? 占位符

  mapToDBFieldType(type: string, collection?: boolean): string {
    // D1 uses SQLite type system
    if (type === 'pk') {
      return 'INTEGER PRIMARY KEY';
    } else if (type === 'id') {
      return 'INTEGER';  // D1/SQLite 使用 INTEGER 而不是 INT
    } else if (collection || type === 'object' || type === 'json') {
      return 'JSON';
    } else if (type === 'string') {
      return 'TEXT';
    } else if (type === 'boolean') {
      return 'INTEGER';  // D1/SQLite 不支持 INT(2) 语法
    } else if (type === 'number') {
      return 'INTEGER';  // D1/SQLite 使用 INTEGER 而不是 INT
    } else if (type === 'timestamp') {
      return 'INTEGER';  // D1/SQLite 使用 INTEGER 而不是 INT
    } else if (type === 'Date') {
      return 'TEXT'; // Date 类型存储为 TEXT
    } else {
      return 'TEXT';
    }
  }

  parseMatchExpression(
    key: string,
    value: [string, string],
    fieldName: string,
    fieldType: string,
    isReferenceValue: boolean,
    getReferenceFieldValue: (v: string) => string,
    p: () => string
  ) {
    if (fieldType === 'JSON') {
      if (value[0].toLowerCase() === 'contains') {
        return {
          fieldValue: `NOT NULL AND EXISTS (
    SELECT 1
    FROM json_each(${fieldName})
    WHERE json_each.value = ${p()}
)`,
          fieldParams: [value[1]]
        };
      }
    }
  }

  async close(): Promise<any> {
    // D1 doesn't need explicit connection closing
    return Promise.resolve();
  }
}
